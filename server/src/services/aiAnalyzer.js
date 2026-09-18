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
  analyzeProblem: localAnalyzeProblem,
  normalizeDedupKey,
  priorityLabelFor,
  buildAnalysisPrompt,
  sanitizeAnalysis,
  validateAiFactors,
} = require("./analyzeHelpers");
const { aiConfig, isAiConfigured } = require("./aiConfig");
const { aiFactorsFromLocalRules, sanitizeAiFactors, validateAiFactors: validateFactorSchema } = require("./aiFactors");
const { prioritize, priorityTierFor, aiOnlyPriorityScore } = require("../utils/categorize");
const aiMetrics = require("./aiMetrics");
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
  const local = localAnalyzeProblem(input);
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

// =====================================================================
// FEATURE 1: AI priority factor extraction (analyzeProblem)
// =====================================================================
// Runs OFF the request path (see services/analysisQueue.js): POST /api/problems
// saves with analysisStatus='pending' and answers immediately; this function
// then fills in aiFactors / aiPriorityScore / finalPriorityScore / priorityTier.
//
// Unlike analyzeGrievance() above — which classifies and rewrites — this path has
// a deliberately narrow contract: extract the five aiFactors, nothing else. A
// small contract means the JSON can be validated strictly, which means a bad
// model answer can never become a stored number.

const ANALYSIS_FEATURE = "problem_analysis";
const ANALYZE_TIMEOUT_MS_DEFAULT = 8000;

function analyzeTimeoutMs() {
  const configured = Number(process.env.AI_ANALYZE_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : ANALYZE_TIMEOUT_MS_DEFAULT;
}

/**
 * Defence in depth for the queue: even if an adapter ignored its own timeout
 * option, one hung request must not stall every later job. 8s is deliberately
 * below the 20s frontend timeout and below the 15s AI_TIMEOUT_MS used by the
 * classification chain, because nothing here is blocking a citizen.
 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(providerError("grok", "timeout", 408, `${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Accepts a Mongoose document or a plain object: the queue passes a document,
// the reanalyze route and tests may pass either.
function analysisInputFrom(problem = {}) {
  return {
    title: problem.title,
    description: problem.description,
    district: problem.district,
    block: problem.block,
    category: problem.category,
    scaleOfImpact: problem.scaleOfImpact,
    durationDays: problem.durationDays,
    reportCount: problem.reportCount,
    photoCount: Array.isArray(problem.photos) ? problem.photos.length : Number(problem.photoCount || 0),
  };
}

/**
 * NEVER throws — same contract as analyzeGrievance().
 *
 * A grievance must still be saved, ranked and shown when Grok is down,
 * rate-limited, misconfigured, or answers with JSON that does not match the
 * aiFactors schema. Every one of those outcomes degrades to the Local Rules
 * factors with analysisStatus='failed_fallback' and is counted in
 * services/aiMetrics.js, so the fallback rate is visible in the logs and at
 * GET /api/stats/ai-metrics.
 */
async function analyzeProblem(problem) {
  const input = analysisInputFrom(problem);
  const startedAt = Date.now();
  const timeoutMs = analyzeTimeoutMs();

  let factors;
  let analysisStatus;
  let fallbackReason = null;

  if (!isAiConfigured("grok")) {
    // Not a crash — just an unmetered deployment. Labelled honestly so the admin
    // view can tell "no key configured" apart from "the provider is failing".
    factors = sanitizeAiFactors(aiFactorsFromLocalRules(input), { source: "local_rules" });
    analysisStatus = "failed_fallback";
    fallbackReason = "ai_not_configured";
    aiMetrics.recordAiCall({
      feature: ANALYSIS_FEATURE,
      provider: "local_rules",
      ok: false,
      latencyMs: 0,
      fallbackUsed: true,
      errorType: fallbackReason,
      error: "XAI_API_KEY / AI_API_KEY is not set",
    });
  } else {
    try {
      const raw = await withTimeout(
        grokProvider.extractPriorityFactors(input, { timeoutMs }),
        timeoutMs,
        "Grok factor extraction"
      );
      // The adapter validates too; re-checking here means a future adapter — or a
      // stubbed one in tests — can never slip an unvalidated payload into Mongo.
      validateFactorSchema(raw);
      factors = sanitizeAiFactors(raw, { source: "llm", provider: "grok", model: aiConfig().model });
      analysisStatus = "done";
      aiMetrics.recordAiCall({
        feature: ANALYSIS_FEATURE,
        provider: "grok",
        ok: true,
        latencyMs: Date.now() - startedAt,
      });
    } catch (err) {
      const errorType = (err && err.errorType) || (/timed out/i.test((err && err.message) || "") ? "timeout" : "other");
      factors = sanitizeAiFactors(aiFactorsFromLocalRules(input), { source: "local_rules" });
      analysisStatus = "failed_fallback";
      fallbackReason = errorType;
      console.warn(
        `[ai] Grok factor extraction failed (${errorType}) after ${Date.now() - startedAt}ms — using Local Rules factors: ${
          err && err.message
        }`
      );
      aiMetrics.recordAiCall({
        feature: ANALYSIS_FEATURE,
        provider: "grok",
        ok: false,
        latencyMs: Date.now() - startedAt,
        fallbackUsed: true,
        errorType,
        error: err && err.message,
      });
    }
  }

  const { localCategory, scalePopulationHint, ...storedFactors } = factors;
  const category = input.category || localCategory;

  // The same pure formula as before, now fed the AI factors as additional INPUTS
  // (weights untouched — see utils/categorize.js).
  const scoring = prioritize({ ...input, category, aiFactors: storedFactors });
  const finalPriorityScore = scoring.score;

  return {
    aiFactors: storedFactors,
    aiPriorityScore: aiOnlyPriorityScore({ category, aiFactors: storedFactors }),
    finalPriorityScore,
    // Kept in step so every existing dashboard/sort that reads priorityScore
    // shows the same number the tier badge is derived from.
    priorityScore: finalPriorityScore,
    priorityTier: priorityTierFor(finalPriorityScore),
    priorityLabel: priorityLabelFor(finalPriorityScore),
    priorityReasons: scoring.reasons,
    factorBreakdown: { ...scoring.factors, scalePopulationHint },
    analysisStatus,
    fallbackReason,
    analyzedAt: new Date(),
    provider: storedFactors.provider || "local_rules",
    model: storedFactors.model || null,
    latencyMs: Date.now() - startedAt,
  };
}


module.exports = {
  analyzeGrievance,
  // Feature 1 entry point (background job) + its helpers.
  analyzeProblem,
  analysisInputFrom,
  analyzeTimeoutMs,
  ANALYSIS_FEATURE,
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

