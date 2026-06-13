import ZAI from 'z-ai-web-dev-sdk';
import type { ScoredThread } from './scorer';
import type { VectorScoredThread } from './vector-scorer';
import { retry } from './resilience/retry';

const RETRYABLE_LLM_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Decide whether an LLM/SDK error is transient. Retries on rate limits (429)
 * and 5xx, plus errors that carry no HTTP status (network/timeout); fails fast
 * on other 4xx (bad request, auth) which a retry would not fix.
 */
function isRetryableLlmError(error: unknown): boolean {
  const status =
    (error as { status?: number; statusCode?: number } | null)?.status ??
    (error as { statusCode?: number } | null)?.statusCode;
  if (typeof status === 'number') return RETRYABLE_LLM_STATUS.has(status);
  return true;
}

// Union type to support both legacy scored threads and vector-scored threads
type ThreadInput = ScoredThread | VectorScoredThread;

/**
 * Check if a thread input is a VectorScoredThread (from VectorAI DB).
 */
function isVectorScored(thread: ThreadInput): thread is VectorScoredThread {
  return 'semanticScore' in thread && typeof thread.semanticScore === 'number';
}

export async function draftReply(
  thread: ThreadInput,
  businessProfile: {
    name: string;
    description: string;
    valueProposition: string;
    replyTone: string;
    website: string;
  },
  ragContext?: {
    similarThreadTitles: string[];
    similarThreadSnippets: string[];
  }
): Promise<string> {
  const zai = await ZAI.create();

  // Build RAG context section if available
  let ragSection = '';
  if (ragContext && ragContext.similarThreadTitles.length > 0) {
    const contextLines = ragContext.similarThreadTitles
      .map((title, i) => {
        const snippet = ragContext.similarThreadSnippets[i] || '';
        return `  ${i + 1}. "${title}"${snippet ? `\n     ${snippet.substring(0, 200)}` : ''}`;
      })
      .join('\n');

    ragSection = `
CONTEXT FROM SEMANTIC SEARCH (similar threads for reference):
${contextLines}

Use this context to understand what kind of questions and discussions are common
in this community. Do NOT directly reference these other threads in your reply.
`;
  }

  // Build context based on thread type
  let threadContext = '';
  if (isVectorScored(thread)) {
    // Vector-scored thread: has semantic similarity score
    threadContext = `
Title: ${thread.post.title}

Post content: ${thread.post.selftext}

Subreddit: r/${thread.post.subreddit}

Semantic relevance: ${(thread.semanticScore * 100).toFixed(1)}% match to your expertise
Engagement score: ${thread.engagementScore}/100
${ragSection}
Your expertise area: ${businessProfile.valueProposition}`;
  } else {
    // Legacy keyword-scored thread
    threadContext = `
Title: ${thread.post.title}

Post content: ${thread.post.selftext}

Subreddit: r/${thread.post.subreddit}

Context: The post mentions these keywords: ${thread.matchedKeywords.join(', ') || 'none'}
${thread.matchedCompetitors.length > 0 ? `Competitor mentioned: ${thread.matchedCompetitors.join(', ')}` : ''}
${thread.intentSignals.length > 0 ? `Buying signals detected: ${thread.intentSignals.join(', ')}` : ''}

Your expertise area: ${businessProfile.valueProposition}`;
  }

  const systemPrompt = `You are an experienced Reddit user who genuinely helps people. You work at ${businessProfile.name} but you never pitch or sell. You share knowledge from your experience.

RULES FOR REDDIT REPLIES:
1. NEVER mention your company name or website in the reply
2. NEVER sound like an ad or pitch
3. Share genuine, helpful advice based on real expertise
4. Be conversational, use casual language
5. Keep it concise (2-4 paragraphs max)
6. If relevant, share a perspective that naturally aligns with your expertise in: ${businessProfile.description}
7. Use phrases like "In my experience..." or "What's worked well for us..." to add credibility
8. Tone: ${businessProfile.replyTone}
9. Never use marketing language or buzzwords
10. End with a question to keep the conversation going if appropriate`;

  const userPrompt = `Write a helpful Reddit reply to this post:

${threadContext}

Write a reply that is genuinely helpful and would get upvoted on Reddit. Do NOT mention your company.`;

  try {
    // Retry transient LLM failures (429 rate limits, 5xx, network/timeout)
    // with exponential backoff + jitter instead of failing the whole draft.
    const completion = await retry(
      () =>
        zai.chat.completions.create({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.8,
          max_tokens: 500,
        }),
      {
        maxAttempts: 3,
        baseDelayMs: 500,
        shouldRetry: (error) => isRetryableLlmError(error),
      }
    );

    return completion.choices[0]?.message?.content || '';
  } catch (error) {
    console.error('Error drafting reply:', error);
    throw error;
  }
}

/**
 * Draft a reply with RAG context fetched from VectorAI DB.
 * Retrieves similar threads to provide the LLM with community context.
 */
export async function draftReplyWithRAG(
  thread: VectorScoredThread,
  businessProfile: {
    name: string;
    description: string;
    valueProposition: string;
    replyTone: string;
    website: string;
  }
): Promise<string> {
  // Import dynamically to avoid circular deps at module level
  const { semanticSearch } = await import('./vector-store');

  // Fetch similar threads for RAG context
  let ragContext: { similarThreadTitles: string[]; similarThreadSnippets: string[] } | undefined;
  try {
    const queryText = `${thread.post.title} ${thread.post.selftext}`.substring(0, 1000);
    const similar = await semanticSearch({
      queryText,
      topK: 5,
      subredditFilter: [thread.post.subreddit],
    });

    // Filter out the current thread
    const otherThreads = similar.filter(r => r.id !== thread.post.id);
    if (otherThreads.length > 0) {
      ragContext = {
        similarThreadTitles: otherThreads.map(r => r.title),
        similarThreadSnippets: otherThreads.map(r => r.selftext?.substring(0, 300) || ''),
      };
    }
  } catch (error) {
    console.warn('RAG context fetch failed, proceeding without context:', error);
  }

  return draftReply(thread, businessProfile, ragContext);
}
