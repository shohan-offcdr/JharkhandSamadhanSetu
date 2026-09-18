/**
 * circuitBreaker.js — simple in-memory circuit breaker for AI providers.
 *
 * One small Map of counters + timestamps is enough at this scale; no
 * external library. A provider is "open" (skipped) for CB_COOLDOWN_MS once it
 * has thrown CB_FAILURE_THRESHOLD times within CB_WINDOW_MS. While open the
 * orchestrator skips the provider entirely and fails over to the next one, so a
 * down/exhausted upstream stops adding latency to every grievance submission.
 *
 * Env overrides (server/.env):
 *   CB_FAILURE_THRESHOLD  (default 5)
 *   CB_COOLDOWN_MS        (default 60000, i.e. 1 minute)
 *   CB_WINDOW_MS          (default 300000, i.e. 5 minute rolling window)
 */
const CB_FAILURE_THRESHOLD = Number(process.env.CB_FAILURE_THRESHOLD || 5);
const CB_COOLDOWN_MS = Number(process.env.CB_COOLDOWN_MS || 60000);
const CB_WINDOW_MS = Number(process.env.CB_WINDOW_MS || 300000);

function now() {
  return Date.now();
}

const state = new Map();

function stateOf(provider) {
  const s = state.get(provider);
  if (!s) {
    const fresh = { failures: 0, firstFailureAt: 0, openedAt: 0 };
    state.set(provider, fresh);
    return fresh;
  }
  return s;
}

// Half-open: once the cooldown has elapsed, allow a single probe call.
function isOpen(provider) {
  const s = stateOf(provider);
  if (!s.openedAt) return false;
  if (now() - s.openedAt >= CB_COOLDOWN_MS) {
    s.openedAt = 0;
    s.failures = 0;
    s.firstFailureAt = 0;
    return false;
  }
  return true;
}

function allow(provider) {
  const s = stateOf(provider);
  // Rolling-window decay: if the failure window has aged out, reset and allow.
  if (s.firstFailureAt && now() - s.firstFailureAt > CB_WINDOW_MS) {
    state.delete(provider);
    return true;
  }
  return !isOpen(provider);
}

function recordFailure(provider) {
  const s = stateOf(provider);
  s.failures += 1;
  if (!s.firstFailureAt) s.firstFailureAt = now();
  if (s.failures >= CB_FAILURE_THRESHOLD) {
    s.openedAt = now();
  }
  return s;
}

function recordSuccess(provider) {
  state.delete(provider);
}

function reset(provider) {
  if (provider) {
    state.delete(provider);
  } else {
    state.clear();
  }
}

function snapshot() {
  const out = {};
  for (const [provider, s] of state.entries()) {
    out[provider] = { failures: s.failures, openedAt: s.openedAt };
  }
  return out;
}

module.exports = {
  allow,
  recordFailure,
  recordSuccess,
  reset,
  snapshot,
  CB_FAILURE_THRESHOLD,
  CB_COOLDOWN_MS,
  CB_WINDOW_MS,
};
