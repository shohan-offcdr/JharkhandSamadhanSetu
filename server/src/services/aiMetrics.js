/**
 * aiMetrics.js — latency and failure-rate counters for every AI/embedding call.
 *
 * Why it exists: the platform degrades silently by design (Grok -> Local Rules,
 * LLM matching -> cosine-only). That safety net hides the thing operators most
 * need to see — how often the paid provider is actually working. These counters
 * make fallback frequency visible in the logs with no external dependency, and
 * are exposed read-only at GET /api/stats/ai-metrics.
 *
 * In-process only (same trade-off as services/circuitBreaker.js): counters reset
 * on restart and are per-instance. If the API is ever scaled horizontally this
 * is the first thing to move to Redis/Prometheus.
 *
 * Env (server/.env):
 *   AI_METRICS_LOG_EVERY       log an aggregate line every N calls (default 25, 0 = off)
 *   AI_METRICS_LATENCY_WINDOW  recent latencies kept per feature (default 200)
 */
const LATENCY_WINDOW_DEFAULT = 200;

function logEvery() {
  const value = Number(process.env.AI_METRICS_LOG_EVERY);
  return Number.isFinite(value) ? value : 25;
}

function latencyWindowSize() {
  const value = Number(process.env.AI_METRICS_LATENCY_WINDOW);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : LATENCY_WINDOW_DEFAULT;
}

// feature -> counters. Read at call time (not module load) so tests and env
// reloads behave predictably.
const counters = new Map();

function blank() {
  return {
    calls: 0,
    ok: 0,
    failed: 0,
    fallback: 0,
    skipped: 0,
    latencyTotal: 0,
    latencies: [],
    lastLatencyMs: 0,
    lastError: null,
    lastErrorAt: null,
  };
}

function entryFor(feature) {
  const key = String(feature || "unknown");
  let entry = counters.get(key);
  if (!entry) {
    entry = blank();
    counters.set(key, entry);
  }
  return entry;
}

function percentile(sortedValues, fraction) {
  if (!sortedValues.length) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * fraction) - 1));
  return sortedValues[index];
}

/**
 * Records one upstream AI call.
 *
 * @param {object} call
 * @param {string} call.feature         "problem_analysis" | "problem_matching" | "embedding" | ...
 * @param {string} [call.provider]      "grok" | "openai" | "gemini" | "local_rules" | ...
 * @param {boolean} call.ok             did the provider return a usable answer?
 * @param {number} [call.latencyMs]
 * @param {boolean} [call.fallbackUsed] the caller degraded to local rules / cosine-only
 * @param {boolean} [call.skipped]      the call was avoided on purpose (dedup guard) = cost saved
 * @param {string} [call.errorType]     typed provider error / "timeout" / "invalid_json" / ...
 * @param {string} [call.error]
 */
function recordAiCall({ feature, provider, ok = true, latencyMs = 0, fallbackUsed = false, skipped = false, errorType, error } = {}) {
  const entry = entryFor(feature);
  const ms = Number.isFinite(Number(latencyMs)) ? Math.max(0, Math.round(Number(latencyMs))) : 0;

  if (skipped) {
    entry.skipped += 1;
    // A skipped call is not a call: it must not drag the failure rate around.
    return summaryFor(feature);
  }

  entry.calls += 1;
  entry.latencyTotal += ms;
  entry.lastLatencyMs = ms;
  entry.latencies.push(ms);
  const window = latencyWindowSize();
  if (entry.latencies.length > window) entry.latencies.splice(0, entry.latencies.length - window);

  if (ok) {
    entry.ok += 1;
  } else {
    entry.failed += 1;
    entry.lastError = error ? String(error).slice(0, 300) : errorType || "unknown";
    entry.lastErrorAt = new Date().toISOString();
  }
  if (fallbackUsed) entry.fallback += 1;

  // One greppable line per call (latency + whether we had to degrade), plus an
  // aggregate line every N calls so the fallback RATE is visible as a trend.
  console.log(
    `[ai-${ok ? "ok" : "fail"}] feature=${feature} provider=${provider || "unknown"} latency=${ms}ms ` +
      `fallback=${fallbackUsed ? "yes" : "no"}${errorType ? ` errorType=${errorType}` : ""}`
  );

  const every = logEvery();
  if (every > 0 && entry.calls % every === 0) {
    const summary = summaryFor(feature);
    console.warn(
      `[ai-metrics] ${feature}: calls=${summary.calls} failureRate=${(summary.failureRate * 100).toFixed(1)}% ` +
        `fallbackRate=${(summary.fallbackRate * 100).toFixed(1)}% p50=${summary.p50LatencyMs}ms ` +
        `p95=${summary.p95LatencyMs}ms avg=${summary.avgLatencyMs}ms skipped=${summary.skipped}`
    );
  }

  return summaryFor(feature);
}

function summaryFor(feature) {
  const entry = entryFor(feature);
  const sorted = [...entry.latencies].sort((a, b) => a - b);
  return {
    feature,
    calls: entry.calls,
    ok: entry.ok,
    failed: entry.failed,
    fallback: entry.fallback,
    skipped: entry.skipped,
    failureRate: entry.calls ? Number((entry.failed / entry.calls).toFixed(4)) : 0,
    fallbackRate: entry.calls ? Number((entry.fallback / entry.calls).toFixed(4)) : 0,
    avgLatencyMs: entry.calls ? Math.round(entry.latencyTotal / entry.calls) : 0,
    lastLatencyMs: entry.lastLatencyMs,
    p50LatencyMs: percentile(sorted, 0.5),
    p95LatencyMs: percentile(sorted, 0.95),
    lastError: entry.lastError,
    lastErrorAt: entry.lastErrorAt,
  };
}

/** Whole-process snapshot, safe to serialise (GET /api/stats/ai-metrics). */
function snapshot() {
  const features = {};
  let calls = 0;
  let failed = 0;
  let fallback = 0;
  let skipped = 0;
  for (const feature of counters.keys()) {
    const summary = summaryFor(feature);
    features[feature] = summary;
    calls += summary.calls;
    failed += summary.failed;
    fallback += summary.fallback;
    skipped += summary.skipped;
  }
  return {
    totals: {
      calls,
      failed,
      fallback,
      skipped,
      failureRate: calls ? Number((failed / calls).toFixed(4)) : 0,
      fallbackRate: calls ? Number((fallback / calls).toFixed(4)) : 0,
    },
    features,
  };
}

function reset(feature) {
  if (feature) counters.delete(String(feature));
  else counters.clear();
}

module.exports = { recordAiCall, snapshot, reset, summaryFor };