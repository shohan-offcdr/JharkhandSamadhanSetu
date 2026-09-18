/**
 * aiAnalyzer.js — server-only grievance priority enrichment with multi-provider
 * fallback: Grok -> Gemini -> Local Rules.
 *
 * Browser must never see API keys, so every provider call happens here.
 * analyzeGrievance() NEVER throws: every failure mode (missing key, timeout,
 * rate limit, quota, bad JSON, all providers down) degrades to the local-rules
 * engine so a citizen submission is never lost.
 *
 * Provider selection, failover and the circuit-breaker live here; the per-
 * provider adapters only know how to call their upstream and return the same
 * normalized aiFactors shape.
 */
const {
  analyzeProblem,
  normalizeDedupKey,
  priorityLabelFor,
  buildAnalysisPrompt,
  sanitizeAnalysis,
  validateAiFactors,
} = require("./analyzeHelpers");
const { aiConfig, isAiConfigured } = require("./aiConfig");
const circuitBreaker = require("./circuitBreaker");
const grokProvider = require("./providers/grokProvider");
const geminiProvider = require("./providers/geminiProvider");
const { FAILOVER_TYPES, providerError } = require("./providerError");

// Map a configurable provider name to its adapter + model accessor.
const PROVIDERS = {
  grok: { adapter: grokProvider, model: () => aiConfig().model },
  gemini: { adapter: geminiProvider, model: () => aiConfig().geminiModel },
};

function normalizeProviderName(name) {
  const n = String(name || "").toLowerCase();
  if (n === "xai") return "grok";
  if (n === "google" || n === "google-generative-ai") return "gemini";
  return n;
}

function providerFor(name) {
  return PROVIDERS[normalizeProviderName(name)];
}

function fallbackAnalysis(input) {
  const local = analyzeProblem(input);
  const text = `${input.title || ""} ${input.description || ""}`.trim();
  return {
    category: local.category,
    categoryConfidence: 0.5,
    problemStatement: text.slice(0, 800),
    enrichedDescription: text.slice(0, 2000),
    priorityScore: local.priorityScore,
    priorityLabel: priorityLabelFor(local.priorityScore),
    priorityReasons:
      local.priorityReasons && local.priorityReasons.length
        ? local.priorityReasons
        : [
            input.scaleOfImpact ? `Scale: ${input.scaleOfImpact}` : "Scale not specified",
            `Pending ${Number(input.durationDays || 0)} day(s)`,
          ],
    dedupKey: normalizeDedupKey(`${input.title} ${input.description}`),
    district: local.district,
    tokens: local.tokens,
    analysisVersion: "local-semantic-v2",
  };
}

const DEFAULT_ORDER = ["grok", "gemini"];

// Try providers in order; re-validate each result. Returns the first success
// or throws a typed provider error describing the last failure.
async function runProviders(input, order) {
  let lastError = providerError("all", "other", 0, "No AI providers available");

  for (const requested of order) {
    const name = normalizeProviderName(requested);
    const entry = providerFor(name);

    if (!entry) {
      lastError = providerError(name, "other", 500, `Unknown provider: ${name}`);
      console.warn(`[ai] unknown provider '${name}', skipping`);
      continue;
    }

    if (!isAiConfigured(name)) {
      lastError = providerError(name, "other", 500, `Provider '${name}' is not configured (missing key)`);
      console.warn(`[ai] ${name} not configured (no key), skipping`);
      continue;
    }

    // Circuit breaker: skip a provider that is currently open rather than
    // paying its latency on every call.
    if (!circuitBreaker.allow(name)) {
      lastError = providerError(name, "rate_limit", 429, `Circuit breaker open for ${name}`);
      console.warn(`[ai] ${name} circuit breaker open — skipping failover check`);
      circuitBreaker.recordFailure(name);
      continue;
    }

    try {
      const raw = await entry.adapter.extractFactors(input);
      // Validate even though the adapter already clamped: defense in depth.
      const analysis = sanitizeAnalysis(raw, input);
      validateAiFactors(analysis);
      analysis.aiMeta = raw.aiMeta || { provider: name, model: entry.model(), analyzedAt: new Date() };
      analysis.aiProviderUsed = name === "grok" ? "grok" : "gemini";
      analysis.analysisStatus = "ok";
      circuitBreaker.recordSuccess(name);
      return analysis;
    } catch (err) {
      const typed =
        err && err.isProviderError
          ? err
          : providerError(name, "other", err && err.status ? err.status : 0, (err && err.message) || "Provider failed");
      lastError = typed;

      if (FAILOVER_TYPES.includes(typed.errorType)) {
        // log differently so the failure-type breakdown is visible later.
        console.warn(
          `[ai] ${name} ${typed.errorType} (HTTP ${typed.status}) — failing over: ${typed.message}`
        );
      } else {
        console.warn(`[ai] ${name} failed (${typed.errorType}): ${typed.message}`);
      }
      circuitBreaker.recordFailure(name);
      // fall through to the next provider in the order list.
    }
  }

  throw lastError;
}


// Never throws: AI failure degrades to local rules so a citizen submission is
// never lost because Grok/Gemini was down / slow / misconfigured.
async function analyzeGrievance(input) {
  const cfg = aiConfig();
  const order = cfg.order.length ? cfg.order : DEFAULT_ORDER;

  // If neither provider is configured, skip the network entirely.
  if (!isAiConfigured("grok") && !isAiConfigured("gemini")) {
    const analysis = fallbackAnalysis(input);
    analysis.aiProviderUsed = "local_rules";
    analysis.analysisStatus = "ok";
    return analysis;
  }

  try {
    return await runProviders(input, order);
  } catch (err) {
    console.warn("[ai] all configured providers failed, using local rules:", err.message);
    const analysis = fallbackAnalysis(input);
    analysis.aiProviderUsed = "local_rules";
    analysis.analysisStatus = "failed_fallback";
    return analysis;
  }
}

module.exports = {
  analyzeGrievance,
  isAiConfigured,
  aiConfig,
  buildAnalysisPrompt,
  fallbackAnalysis,
  sanitizeAnalysis,
  validateAiFactors,
  DEFAULT_ORDER,
  // Exported for tests that want to assert the chain without hitting the network.
  runProviders,
  normalizeProviderName,
  FAILOVER_TYPES,
};

