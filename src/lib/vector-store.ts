/**
 * vector-store.ts — Actian VectorAI DB client wrapper
 *
 * Communicates with the vectorai-bridge.py Python service which wraps the
 * Actian VectorAI DB Python client (gRPC) and local embedding model.
 *
 * Architecture:
 *   Next.js (TypeScript)  →  REST HTTP  →  vectorai-bridge.py  →  gRPC  →  VectorAI DB
 *                                                    ↓
 *                                          sentence-transformers (embeddings)
 *
 * Setup:
 *   1. docker compose up vectorai-db    # Start VectorAI DB (gRPC on :50051)
 *   2. docker compose up vectorai-bridge # Start bridge (REST on :27832)
 *      Or manually: pip install actian-vectorai sentence-transformers flask flask-cors
 *                   python vectorai-bridge.py
 */

import { safeFetch } from './resilience/safeFetch';

// ─── Types ───────────────────────────────────────────────────────────

export interface ThreadVectorRecord {
  id: string;               // Reddit post ID
  vector: number[];         // Embedding
  subreddit: string;
  title: string;
  selftext: string;
  author: string;
  score: number;            // Reddit upvotes
  numComments: number;
  createdAtReddit: number;  // Unix timestamp
  url: string;
}

export interface SemanticSearchResult {
  id: string;
  title: string;
  subreddit: string;
  selftext: string;
  author: string;
  score: number;
  numComments: number;
  createdAtReddit: number;
  url: string;
  similarity: number;       // 0–1 semantic similarity score
}

export interface VectorSearchOptions {
  queryText: string;                  // Text to embed and search with
  topK?: number;                      // Max results (default 20)
  subredditFilter?: string[];         // Restrict to these subreddits
  minAgeHours?: number;               // Only threads newer than this
  maxAgeHours?: number;               // Only threads older than this
  minComments?: number;               // Minimum engagement threshold
  minScore?: number;                  // Minimum upvote threshold
}

export interface HybridSearchOptions extends VectorSearchOptions {
  engagementWeight?: number;   // Weight for engagement score in fused ranking (0–1, default 0.3)
}

type VectorMetadataFilters = Record<string, { $in?: string[]; $gte?: number; $lte?: number }>;

function asFiniteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 128);
}

/**
 * Build VectorAI metadata filters from coerced scalars only.
 * Never spreads caller-supplied objects, so `$where` / operator payloads
 * cannot be injected into the bridge query.
 */
export function buildVectorMetadataFilters(options: {
  subredditFilter?: unknown;
  minAgeHours?: unknown;
  maxAgeHours?: unknown;
  minComments?: unknown;
  minScore?: unknown;
  now?: number;
}): VectorMetadataFilters {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const filters: VectorMetadataFilters = {};
  const subreddits = asStringList(options.subredditFilter);
  if (subreddits.length > 0) {
    filters.subreddit = { $in: subreddits };
  }

  const maxAgeHours = asFiniteNumber(options.maxAgeHours, 0);
  if (maxAgeHours > 0) {
    filters.created_at_reddit = { $gte: now - maxAgeHours * 3600 };
  }

  const minAgeHours = asFiniteNumber(options.minAgeHours, 0);
  if (minAgeHours > 0) {
    filters.created_at_reddit = {
      ...filters.created_at_reddit,
      $lte: now - minAgeHours * 3600,
    };
  }

  const minComments = asFiniteNumber(options.minComments, 0);
  if (minComments > 0) {
    filters.num_comments = { $gte: minComments };
  }

  const minScore = asFiniteNumber(options.minScore, 0);
  if (minScore > 0) {
    filters.score = { $gte: minScore };
  }

  return filters;
}

// ─── Configuration ──────────────────────────────────────────────────

const BRIDGE_CONFIG = {
  /**
   * URL of the vectorai-bridge.py REST service.
   * This bridge wraps the Actian VectorAI DB gRPC client + embedding model.
   */
  bridgeUrl: process.env.VECTORAI_BRIDGE_URL || process.env.EMBEDDING_SERVER_URL || 'http://localhost:27832',
  collectionName: process.env.VECTORAI_COLLECTION || 'reddit_threads',
};

// ─── Embedding via local model (through bridge) ────────────────────

/**
 * Generate embedding vector for text using the local embedding server.
 * The bridge runs sentence-transformers/all-MiniLM-L6-v2 (384-dim).
 */
export async function embedText(text: string): Promise<number[]> {
  const response = await safeFetch(`${BRIDGE_CONFIG.bridgeUrl}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Embedding failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.embedding;
}

/**
 * Batch embed multiple texts in one call (faster than one-by-one).
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const response = await safeFetch(`${BRIDGE_CONFIG.bridgeUrl}/api/embed-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
  });

  if (!response.ok) {
    throw new Error(`Batch embedding failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.embeddings;
}

// ─── VectorAI DB Operations (through bridge REST API) ──────────────

/**
 * Initialize a collection in VectorAI DB via the bridge.
 * Uses the actian-vectorai Python client under the hood:
 *   client.collections.create(name, VectorParams(size=384, distance=Cosine))
 */
export async function initCollection(): Promise<void> {
  const response = await safeFetch(`${BRIDGE_CONFIG.bridgeUrl}/api/collections/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: BRIDGE_CONFIG.collectionName,
      dimension: 384, // all-MiniLM-L6-v2 output dimension
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to init collection: ${response.status} ${await response.text()}`);
  }
}

/**
 * Upsert thread vectors into VectorAI DB via the bridge.
 * Uses the actian-vectorai Python client under the hood:
 *   client.points.upsert(collection, [PointStruct(...), ...])
 */
export async function upsertThreads(threads: ThreadVectorRecord[]): Promise<void> {
  if (threads.length === 0) return;

  // Upsert in batches of 50 for reliability
  const BATCH_SIZE = 50;
  for (let i = 0; i < threads.length; i += BATCH_SIZE) {
    const batch = threads.slice(i, i + BATCH_SIZE);

    const response = await safeFetch(
      `${BRIDGE_CONFIG.bridgeUrl}/api/collections/${BRIDGE_CONFIG.collectionName}/upsert`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: batch.map(t => t.id),
          vectors: batch.map(t => t.vector),
          metadata: batch.map(t => ({
            subreddit: t.subreddit,
            title: t.title,
            author: t.author,
            score: t.score,
            num_comments: t.numComments,
            created_at_reddit: t.createdAtReddit,
            url: t.url,
          })),
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Upsert failed: ${response.status} ${await response.text()}`);
    }
  }
}

/**
 * Semantic similarity search in VectorAI DB with metadata filters.
 * Uses the actian-vectorai Python client under the hood:
 *   client.points.search(collection, vector=..., limit=..., filter=...)
 *
 * The bridge converts filter conditions into the VectorAI FilterBuilder DSL.
 */
export async function semanticSearch(
  options: VectorSearchOptions
): Promise<SemanticSearchResult[]> {
  const {
    queryText,
    topK = 20,
    subredditFilter,
    minAgeHours,
    maxAgeHours,
    minComments = 0,
    minScore = 0,
  } = options;

  // Embed the query text
  const queryVector = await embedText(queryText);

  // Build metadata filters from coerced scalars only — never spread caller objects.
  const now = Math.floor(Date.now() / 1000);
  const filters = buildVectorMetadataFilters({
    subredditFilter,
    minAgeHours,
    maxAgeHours,
    minComments,
    minScore,
    now,
  });

  const response = await safeFetch(
    `${BRIDGE_CONFIG.bridgeUrl}/api/collections/${BRIDGE_CONFIG.collectionName}/search`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vector: queryVector,
        top_k: topK,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        include_metadata: true,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();

  return (data.results || []).map((r: any) => ({
    id: r.id,
    title: r.metadata?.title || '',
    subreddit: r.metadata?.subreddit || '',
    selftext: '',
    author: r.metadata?.author || '',
    score: r.metadata?.score || 0,
    numComments: r.metadata?.num_comments || 0,
    createdAtReddit: r.metadata?.created_at_reddit || 0,
    url: r.metadata?.url || '',
    similarity: r.score || r.distance || 0,
  }));
}

/**
 * Hybrid fusion search — combines semantic similarity with engagement metrics.
 * Uses Reciprocal Rank Fusion (RRF) to merge:
 *   - Semantic similarity ranking from VectorAI DB
 *   - Engagement score ranking (comments + upvotes + recency)
 */
export async function hybridSearch(
  options: HybridSearchOptions
): Promise<(SemanticSearchResult & { fusedScore: number })[]> {
  const {
    queryText,
    topK = 20,
    engagementWeight = 0.3,
    ...filterOpts
  } = options;

  // Get semantic results (fetch more for better fusion)
  const semanticResults = await semanticSearch({
    ...filterOpts,
    queryText,
    topK: topK * 3,
  });

  // Calculate engagement score for each result
  const now = Math.floor(Date.now() / 1000);
  const engagementResults = semanticResults.map(result => {
    const ageInHours = (now - result.createdAtReddit) / 3600;
    const commentScore = Math.min(Math.log(result.numComments + 1) * 10, 100);
    const upvoteScore = Math.min(Math.log(result.score + 1) * 8, 100);
    const recencyScore = Math.max(0, 100 - (ageInHours / 168) * 100);

    return {
      ...result,
      engagementScore: (commentScore + upvoteScore + recencyScore) / 3,
    };
  });

  // Reciprocal Rank Fusion (RRF)
  // Rank each result by both signals, then fuse
  const k = 60; // RRF constant (standard value)
  const semanticRanked = [...semanticResults].sort((a, b) => b.similarity - a.similarity);
  const engagementRanked = [...engagementResults].sort((a, b) => b.engagementScore - a.engagementScore);

  const semanticRanks = new Map(semanticRanked.map((r, i) => [r.id, i + 1]));
  const engagementRanks = new Map(engagementRanked.map((r, i) => [r.id, i + 1]));

  const fused = engagementResults.map(result => {
    const sRank = semanticRanks.get(result.id) || topK * 3;
    const eRank = engagementRanks.get(result.id) || topK * 3;
    const rrfScore = 1 / (k + sRank) + 1 / (k + eRank);

    return {
      ...result,
      fusedScore: rrfScore,
    };
  });

  // Sort by fused score and return top K
  return fused
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, topK);
}

/**
 * Delete vectors from VectorAI DB by IDs via the bridge.
 * Uses: client.points.delete(collection, ids)
 */
export async function deleteThreads(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const response = await safeFetch(
    `${BRIDGE_CONFIG.bridgeUrl}/api/collections/${BRIDGE_CONFIG.collectionName}/delete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }
  );

  if (!response.ok) {
    throw new Error(`Delete failed: ${response.status} ${await response.text()}`);
  }
}

/**
 * Get collection stats from VectorAI DB via the bridge.
 * Uses: client.points.count(collection)
 */
export async function getCollectionStats(): Promise<{ count: number; collection: string }> {
  const response = await safeFetch(
    `${BRIDGE_CONFIG.bridgeUrl}/api/collections/${BRIDGE_CONFIG.collectionName}/stats`
  );

  if (!response.ok) {
    // Collection might not exist yet — return 0
    return { count: 0, collection: BRIDGE_CONFIG.collectionName };
  }

  const data = await response.json();
  return {
    count: data.count || 0,
    collection: BRIDGE_CONFIG.collectionName,
  };
}

/**
 * Check health of the bridge service and VectorAI DB.
 */
export async function healthCheck(): Promise<{
  bridge: boolean;
  vectoraiDb: boolean;
  embedding: boolean;
}> {
  try {
    const response = await safeFetch(`${BRIDGE_CONFIG.bridgeUrl}/api/health`);
    if (!response.ok) {
      return { bridge: false, vectoraiDb: false, embedding: false };
    }
    const data = await response.json();
    return {
      bridge: data.status === 'ok',
      vectoraiDb: data.vectorai_db?.status === 'connected',
      embedding: data.embedding?.status === 'loaded',
    };
  } catch {
    return { bridge: false, vectoraiDb: false, embedding: false };
  }
}
