/**
 * providerError.js — typed errors thrown by AI provider adapters.
 *
 * Every provider (grok, gemini) throws these instead of plain Errors so the
 * orchestrator in aiAnalyzer.js can decide, per failure type, whether to fall
 * over to the next provider or short-circuit.
 */
const VALID_TYPES = ["rate_limit", "quota_exceeded", "timeout", "invalid_response", "other"];

// Failures where it still makes sense to try the next provider. rate_limit and
// quota_exceeded are counted against the circuit breaker because they are
// signals that the upstream account/bucket is genuinely exhausted.
const FAILOVER_TYPES = ["rate_limit", "quota_exceeded", "timeout", "invalid_response"];

// 4xx auth failures are treated as quota_exceeded: a different, valid key may
// still work, but the current one is permanent-broken for this call.
function classifyHttpStatus(status) {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "quota_exceeded";
  if (status === 408 || status === 503 || status === 504) return "timeout";
  if (status >= 500) return "other"; // upstream outage
  return "invalid_response"; // 4xx that isn't auth/quota
}

function providerError(provider, errorType, status, message) {
  const err = new Error(message);
  err.provider = provider;
  err.errorType = VALID_TYPES.includes(errorType) ? errorType : "other";
  err.status = typeof status === "number" ? status : 0;
  err.isProviderError = true;
  return err;
}

module.exports = {
  VALID_TYPES,
  FAILOVER_TYPES,
  classifyHttpStatus,
  providerError,
};
