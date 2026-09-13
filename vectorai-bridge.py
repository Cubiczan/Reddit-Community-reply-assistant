"""
vectorai-bridge.py — Actian VectorAI DB bridge server for SemantiQ

Provides a REST API wrapping the Actian VectorAI DB Python client (gRPC)
and a local sentence-transformers embedding model. The Node.js/Next.js
application communicates with this bridge via HTTP.

Actian VectorAI DB:
    - Docker image: williamimoh/actian-vectorai-db:latest
    - gRPC port:   50051
    - Python client: pip install actian-vectorai

Embedding model:
    - sentence-transformers/all-MiniLM-L6-v2 (384-dim, COSINE)

Endpoints:
    GET  /api/health                          Health check (bridge + VectorAI DB)
    POST /api/embed                          {"text": "..."}           -> {"embedding": [...]}
    POST /api/embed-batch                    {"texts": ["...", "..."]} -> {"embeddings": [[...], [...]]}
    POST /api/collections/init               {"name": "...", "dimension": 384}
    POST /api/collections/{name}/upsert       {"ids": [...], "vectors": [...], "metadata": [...]}
    POST /api/collections/{name}/search      {"vector": [...], "top_k": 20, "filters": {...}}
    POST /api/collections/{name}/delete      {"ids": [...]}
    GET  /api/collections/{name}/stats       -> {"count": N, "name": "..."}
    GET  /api/collections                    -> {"collections": [...]}
    POST /api/collections/{name}/count       -> {"count": N}

Usage:
    pip install actian-vectorai sentence-transformers flask flask-cors
    python vectorai-bridge.py

Environment:
    VECTORAI_GRPC_HOST  (default: localhost:50051)
    EMBEDDING_MODEL     (default: sentence-transformers/all-MiniLM-L6-v2)
    BRIDGE_PORT         (default: 27832)
    VECTORAI_COLLECTION (default: reddit_threads)
"""

import os
import sys
import time
import json
import threading
from typing import Optional

from flask import Flask, request, jsonify
from flask_cors import CORS

from vectorai_filters import sanitize_search_filters

# ─── Configuration ──────────────────────────────────────────────────

VECTORAI_GRPC_HOST = os.environ.get("VECTORAI_GRPC_HOST", "localhost:50051")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
BRIDGE_PORT = int(os.environ.get("BRIDGE_PORT", "27832"))
DEFAULT_COLLECTION = os.environ.get("VECTORAI_COLLECTION", "reddit_threads")
VECTOR_DIMENSION = 384  # all-MiniLM-L6-v2 output dimension

app = Flask(__name__)
CORS(app)

# ─── Lazy Initialization ───────────────────────────────────────────

_vectorai_client = None
_vectorai_ready = False
_vectorai_error: Optional[str] = None
_embedding_model = None
_embedding_ready = False
_embedding_error: Optional[str] = None


def get_vectorai_client():
    """
    Lazily initialize the Actian VectorAI DB client.
    Uses sync VectorAIClient which wraps gRPC communication.
    """
    global _vectorai_client, _vectorai_ready, _vectorai_error

    if _vectorai_client is not None:
        return _vectorai_client
    if _vectorai_error is not None:
        raise ConnectionError(_vectorai_error)

    try:
        from actian_vectorai import VectorAIClient, VectorParams, Distance

        print(f"[VectorAI] Connecting to {VECTORAI_GRPC_HOST}...")
        client = VectorAIClient(VECTORAI_GRPC_HOST)

        # Health check
        info = client.health_check()
        print(f"[VectorAI] Connected: {info.get('title', 'unknown')} v{info.get('version', '?')}")

        _vectorai_client = client
        _vectorai_ready = True
        return client
    except Exception as e:
        error_msg = f"VectorAI DB connection failed: {e}"
        print(f"[VectorAI] ERROR: {error_msg}")
        _vectorai_error = error_msg
        raise ConnectionError(error_msg)


def get_embedding_model():
    """Lazily load the sentence-transformers embedding model."""
    global _embedding_model, _embedding_ready, _embedding_error

    if _embedding_model is not None:
        return _embedding_model
    if _embedding_error is not None:
        raise RuntimeError(_embedding_error)

    try:
        from sentence_transformers import SentenceTransformer

        print(f"[Embedding] Loading model: {EMBEDDING_MODEL}...")
        start = time.time()
        model = SentenceTransformer(EMBEDDING_MODEL)
        elapsed = time.time() - start
        print(f"[Embedding] Model loaded in {elapsed:.1f}s")

        _embedding_model = model
        _embedding_ready = True
        return model
    except Exception as e:
        error_msg = f"Embedding model load failed: {e}"
        print(f"[Embedding] ERROR: {error_msg}")
        _embedding_error = error_msg
        raise RuntimeError(error_msg)


def ensure_collection(name: str):
    """
    Ensure a collection exists in VectorAI DB.
    Creates it with 384-dim COSINE vectors if it doesn't exist.
    """
    from actian_vectorai import VectorParams, Distance

    client = get_vectorai_client()

    try:
        if not client.collections.exists(name):
            print(f"[VectorAI] Creating collection '{name}' (dim={VECTOR_DIMENSION}, COSINE)...")
            client.collections.create(
                name,
                vectors_config=VectorParams(size=VECTOR_DIMENSION, distance=Distance.Cosine),
            )
            print(f"[VectorAI] Collection '{name}' created.")
        else:
            print(f"[VectorAI] Collection '{name}' already exists.")
    except Exception as e:
        # It might already exist from a race condition
        print(f"[VectorAI] Collection init note: {e}")


# ─── Health ─────────────────────────────────────────────────────────

@app.route("/api/health", methods=["GET"])
def health():
    """Health check for the bridge, VectorAI DB, and embedding model."""
    vectorai_status = "connected" if _vectorai_ready else ("error" if _vectorai_error else "not_connected")
    embedding_status = "loaded" if _embedding_ready else ("error" if _embedding_error else "not_loaded")

    return jsonify({
        "status": "ok",
        "vectorai_db": {
            "status": vectorai_status,
            "host": VECTORAI_GRPC_HOST,
            "error": _vectorai_error,
        },
        "embedding": {
            "status": embedding_status,
            "model": EMBEDDING_MODEL,
            "dimension": VECTOR_DIMENSION,
            "error": _embedding_error,
        },
    })


# ─── Embedding Endpoints ───────────────────────────────────────────

@app.route("/api/embed", methods=["POST"])
def embed():
    """Embed a single text string into a 384-dim vector."""
    data = request.get_json()
    text = data.get("text", "")
    if not text:
        return jsonify({"error": "text is required"}), 400

    model = get_embedding_model()
    embedding = model.encode(text).tolist()
    return jsonify({"embedding": embedding})


@app.route("/api/embed-batch", methods=["POST"])
def embed_batch():
    """Embed multiple texts into 384-dim vectors."""
    data = request.get_json()
    texts = data.get("texts", [])
    if not texts:
        return jsonify({"error": "texts is required"}), 400

    model = get_embedding_model()
    embeddings = model.encode(texts).tolist()
    return jsonify({"embeddings": embeddings})


# ─── Collection Management ─────────────────────────────────────────

@app.route("/api/collections", methods=["GET"])
def list_collections():
    """List all collections in VectorAI DB."""
    client = get_vectorai_client()
    try:
        collections = client.collections.list()
        return jsonify({"collections": collections})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/collections/init", methods=["POST"])
def init_collection():
    """Initialize a collection (create if it doesn't exist)."""
    data = request.get_json()
    name = data.get("name", DEFAULT_COLLECTION)
    dimension = data.get("dimension", VECTOR_DIMENSION)

    try:
        ensure_collection(name)
        return jsonify({"status": "ok", "collection": name, "dimension": dimension})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/collections/<name>/stats", methods=["GET"])
def collection_stats(name):
    """Get stats for a collection."""
    try:
        client = get_vectorai_client()
        count = client.points.count(name)
        return jsonify({"count": count, "collection": name})
    except Exception as e:
        # Collection might not exist yet
        return jsonify({"count": 0, "collection": name, "error": str(e)})


@app.route("/api/collections/<name>/count", methods=["POST", "GET"])
def collection_count(name):
    """Get point count for a collection."""
    try:
        client = get_vectorai_client()
        count = client.points.count(name)
        return jsonify({"count": count})
    except Exception as e:
        return jsonify({"count": 0, "error": str(e)}), 500


# ─── Vector Operations ─────────────────────────────────────────────

@app.route("/api/collections/<name>/upsert", methods=["POST"])
def upsert_vectors(name):
    """
    Upsert vectors into a collection.
    Body: {"ids": [...], "vectors": [[...], ...], "metadata": [{...}, ...]}
    """
    data = request.get_json()
    ids = data.get("ids", [])
    vectors = data.get("vectors", [])
    metadata = data.get("metadata", [])

    if not ids or not vectors:
        return jsonify({"error": "ids and vectors are required"}), 400

    if len(ids) != len(vectors):
        return jsonify({"error": "ids and vectors must have the same length"}), 400

    try:
        from actian_vectorai import PointStruct

        client = get_vectorai_client()
        ensure_collection(name)

        # Build PointStruct objects
        points = []
        for i, (id_, vector) in enumerate(zip(ids, vectors)):
            point_data = PointStruct(
                id=id_,
                vector=vector,
                payload=metadata[i] if i < len(metadata) else {},
            )
            points.append(point_data)

        # Batch upsert (VectorAI client handles batching internally)
        client.points.upsert(name, points)

        print(f"[VectorAI] Upserted {len(points)} points into '{name}'")
        return jsonify({"status": "ok", "upserted": len(points), "collection": name})

    except Exception as e:
        print(f"[VectorAI] Upsert error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/collections/<name>/search", methods=["POST"])
def search_vectors(name):
    """
    Semantic similarity search with optional metadata filters.
    Body: {
        "vector": [...],
        "top_k": 20,
        "filters": {"subreddit": {"$in": [...]}, "score": {"$gte": 5}},
        "include_metadata": true
    }
    """
    data = request.get_json()
    vector = data.get("vector", [])
    top_k = data.get("top_k", 20)
    try:
        filters = sanitize_search_filters(data.get("filters"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if not vector:
        return jsonify({"error": "vector is required"}), 400

    try:
        from actian_vectorai import Field, FilterBuilder

        client = get_vectorai_client()
        ensure_collection(name)

        # Build filter if provided
        filter_obj = None
        if filters:
            fb = FilterBuilder()
            for field_name, condition in filters.items():
                if isinstance(condition, dict):
                    if "$in" in condition:
                        # For $in, use match_any approach - search without filter
                        # and post-filter (VectorAI DB FilterBuilder doesn't have $in)
                        # We'll handle this with post-filtering below
                        pass
                    elif "$gte" in condition:
                        fb.must(Field(field_name).gte(condition["$gte"]))
                    elif "$lte" in condition:
                        fb.must(Field(field_name).lte(condition["$lte"]))
                    elif "$eq" in condition:
                        fb.must(Field(field_name).eq(condition["$eq"]))
                    elif "$gt" in condition:
                        fb.must(Field(field_name).gt(condition["$gt"]))
                    elif "$lt" in condition:
                        fb.must(Field(field_name).lt(condition["$lt"]))
                elif isinstance(condition, (str, int, float, bool)):
                    fb.must(Field(field_name).eq(condition))

            filter_obj = fb.build()

        # Perform search (fetch extra if we need to post-filter)
        in_filter = filters and any(
            isinstance(v, dict) and "$in" in v for v in filters.values()
        )
        search_limit = top_k * 5 if in_filter else top_k

        results = client.points.search(
            name,
            vector=vector,
            limit=search_limit,
            filter=filter_obj,
        )

        # Post-filter for $in conditions
        if in_filter:
            for field_name, condition in filters.items():
                if isinstance(condition, dict) and "$in" in condition:
                    allowed_values = set(condition["$in"])
                    results = [r for r in results if r.payload.get(field_name) in allowed_values]
            results = results[:top_k]

        # Format results to match the expected API contract
        formatted = []
        for r in results:
            formatted.append({
                "id": r.id,
                "score": r.score,
                "distance": getattr(r, "distance", None),
                "metadata": r.payload if hasattr(r, "payload") else {},
            })

        return jsonify({"results": formatted})

    except Exception as e:
        print(f"[VectorAI] Search error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/collections/<name>/delete", methods=["POST"])
def delete_vectors(name):
    """Delete vectors by IDs from a collection."""
    data = request.get_json()
    ids = data.get("ids", [])

    if not ids:
        return jsonify({"error": "ids is required"}), 400

    try:
        client = get_vectorai_client()
        client.points.delete(name, ids)
        print(f"[VectorAI] Deleted {len(ids)} points from '{name}'")
        return jsonify({"status": "ok", "deleted": len(ids), "collection": name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── Startup ────────────────────────────────────────────────────────

def warmup():
    """Pre-load components in background threads."""
    def warmup_vectorai():
        try:
            get_vectorai_client()
        except Exception:
            pass

    def warmup_embedding():
        try:
            get_embedding_model()
        except Exception:
            pass

    threading.Thread(target=warmup_vectorai, daemon=True).start()
    threading.Thread(target=warmup_embedding, daemon=True).start()


if __name__ == "__main__":
    print("=" * 60)
    print("  SemantiQ — Actian VectorAI DB Bridge Server")
    print("=" * 60)
    print(f"  VectorAI DB gRPC:  {VECTORAI_GRPC_HOST}")
    print(f"  Embedding model:   {EMBEDDING_MODEL}")
    print(f"  Bridge port:       {BRIDGE_PORT}")
    print(f"  Default collection: {DEFAULT_COLLECTION}")
    print(f"  Vector dimension:  {VECTOR_DIMENSION}")
    print("=" * 60)
    print()

    # Start warmup in background
    warmup()

    print(f"Starting bridge server on port {BRIDGE_PORT}...")
    app.run(host="0.0.0.0", port=BRIDGE_PORT, debug=False)
