/**
 * embeddingService.js — text → vector for the startup matching engine (Feature 2).
 *
 * Chosen provider: OpenAI text-embedding-3-small.
 *   - Grok/xAI has no dedicated embeddings endpoint (only chat completions),
 *     so it cannot serve this role.
 *   - Voyage AI is paid-only with no free tier, so it adds cost for a dev/staging
 *     cluster that may not need it.
 *   - A local sentence-transformers Python sidecar would add a second runtime to
 *     maintain; at current scale the cloud call is a single HTTPS round-trip per
 *     doc and is cheaper to operate than running a GPU-capable Python process.
 *
 * The OPENAI_API_KEY env var is the same key you would use for GPT-4/GPT-3.5 if
 * you already have one; a key with embeddings permissions only also works.
 * Never log or echo the key — only the response vector and model name are stored.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536; // text-embedding-3-small default; explicit for future-proofing

function isEmbeddingConfigured() {
  return Boolean(OPENAI_API_KEY && OPENAI_API_KEY.length > 10);
}

/**
 * Embed a single string. Returns a Float32Array of length EMBEDDING_DIMENSIONS
 * on success, or throws on network/auth/error so the caller can degrade.
 *
 * text-embedding-3-small is a 1536-dim model; the response may include fewer dims
 * if the request asked for it, but we always request the full vector so the stored
 * embedding matches what cosine-similarity expects.
 */
async function embedText(text) {
  if (!isEmbeddingConfigured()) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const trimmed = String(text || "").trim();
  if (!trimmed) {
    // Return a zero vector rather than throwing: an empty profile or problem
    // should still exist and match at the bottom of every list rather than break.
    return new Float32Array(EMBEDDING_DIMENSIONS);
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: trimmed,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `OpenAI embeddings HTTP ${response.status}${body ? ` — ${body.slice(0, 200)}` : ""}`
    );
  }

  const json = await response.json().catch(() => null);
  if (!json || !Array.isArray(json.data) || !json.data.length) {
    throw new Error("OpenAI embeddings returned an empty or unexpected response");
  }

  // text-embedding-3-small returns one embedding per input string; our callers
  // always pass a single string, so take data[0].
  const vector = json.data[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("OpenAI embeddings response missing the vector");
  }

  // Normalize to Float32Array for compact storage in MongoDB.
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    out[i] = Number.isFinite(vector[i]) ? vector[i] : 0;
  }
  return out;
}

/**
 * Cosine similarity between two vectors. Both may be Float32Array or plain
 * number[]; a zero/empty vector yields 0 so it sinks to the bottom of a ranking
 * instead of producing NaN and corrupting the whole list.
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = Number.isFinite(a[i]) ? a[i] : 0;
    const bv = Number.isFinite(b[i]) ? b[i] : 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Convert a Float32Array (or number[]) to a plain number[] for MongoDB storage.
 * Mongoose stores [Number] fields as plain arrays.
 */
function toPlainArray(vector) {
  if (!vector || vector.length === 0) return [];
  const out = new Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    out[i] = Number.isFinite(vector[i]) ? vector[i] : 0;
  }
  return out;
}

module.exports = {
  embedText,
  cosineSimilarity,
  toPlainArray,
  isEmbeddingConfigured,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
};
