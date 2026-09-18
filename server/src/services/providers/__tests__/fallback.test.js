/**
 * fallback.test.js — unit tests for the AI provider fallback chain.
 *
 * Runs with plain Node + assert (no test runner dependency). Providers are
 * stubbed so no network or real API keys are exercised.
 *
 *   node server/src/services/providers/__tests__/fallback.test.js
 */
const assert = require("assert");

// Configure keys + a tight circuit breaker BEFORE requiring aiAnalyzer, so the
// module-level constants in circuitBreaker.js pick up the test thresholds.
process.env.XAI_API_KEY = "test-xai-key";
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.AI_PROVIDER_ORDER = "grok,gemini";
process.env.AI_TIMEOUT_MS = "5000";
process.env.CB_FAILURE_THRESHOLD = "1";
process.env.CB_COOLDOWN_MS = "999999";

const aiAnalyzer = require("../../aiAnalyzer");
const grokProvider = require("../grokProvider");
const geminiProvider = require("../geminiProvider");
const circuitBreaker = require("../../circuitBreaker");
const { providerError } = require("../../providerError");

const INPUT = {
  title: "Pipeline leakage near Kanke Dam",
  description: "A pipeline joint near Kanke Dam road has leaked for 12 days, wasting treated water and damaging the road.",
  district: "Ranchi",
  block: "Kanke",
  scaleOfImpact: "Specific Neighbourhood",
  durationDays: 12,
  reportCount: 42,
  photoCount: 1,
};

// Valid raw factors (pre-sanitize) — passes sanitizeAnalysis + validateAiFactors.
// aiMeta intentionally omitted so the orchestrator's default is exercised.
function validRaw(overrides) {
  return Object.assign(
    {
      category: "Drinking Water & Sanitation",
      categoryConfidence: 0.91,
      problemStatement: "Leaking pipeline near Kanke Dam wasting water.",
      enrichedDescription: "A pipeline joint near Kanke Dam road has leaked for 12 days.",
      priorityScore: 91,
      priorityLabel: "Critical",
      priorityReasons: ["Scale: Specific Neighbourhood", "42 citizen reports"],
      dedupKey: "leaking pipeline joint kanke dam",
      district: "ranchi",
    },
    overrides
  );
}

let grokCalls = 0;
let geminiCalls = 0;
let grokLastInput = null;
const originalGrok = grokProvider.extractFactors;
const originalGemini = geminiProvider.extractFactors;

function stubGrok(impl) {
  grokCalls = 0;
  grokLastInput = null;
  grokProvider.extractFactors = async (input) => {
    grokCalls += 1;
    grokLastInput = input;
    return impl(input);
  };
}

function stubGemini(impl) {
  geminiCalls = 0;
  geminiProvider.extractFactors = async (input) => {
    geminiCalls += 1;
    return impl(input);
  };
}

function restore() {
  grokProvider.extractFactors = originalGrok;
  geminiProvider.extractFactors = originalGemini;
  circuitBreaker.reset();
}

const RESULTS = { pass: 0, fail: 0 };

async function run(name, fn) {
  restore();
  try {
    await fn();
    RESULTS.pass += 1;
    console.log("  ok -", name);
  } catch (err) {
    RESULTS.fail += 1;
    console.log("  FAIL -", name);
    console.log("        ", err && err.message ? err.message : err);
  }
}

(async () => {
  console.log("\nfallback.test.js");

  await run("Gemini is called when Grok throws rate_limit", async () => {
    stubGrok(async () => {
      throw providerError("grok", "rate_limit", 429, "rate limited");
    });
    stubGemini((input) => {
      assert.strictEqual(input, grokLastInput, "Gemini should receive the same problem input");
      return validRaw({ aiMeta: { provider: "gemini", model: "gemini-1.5-flash" } });
    });

    const result = await aiAnalyzer.analyzeGrievance(INPUT);
    assert.strictEqual(result.aiProviderUsed, "gemini");
    assert.strictEqual(result.analysisStatus, "ok");
    assert.strictEqual(grokCalls, 1);
    assert.strictEqual(geminiCalls, 1);
    assert.strictEqual(result.category, "Drinking Water & Sanitation");
    assert.strictEqual(result.priorityLabel, "Critical");
  });

  await run("Local rules used when both providers fail", async () => {
    stubGrok(async () => {
      throw providerError("grok", "rate_limit", 429, "limit");
    });
    stubGemini(async () => {
      throw providerError("gemini", "other", 500, "down");
    });

    const result = await aiAnalyzer.analyzeGrievance(INPUT);
    assert.strictEqual(result.aiProviderUsed, "local_rules");
    assert.strictEqual(result.analysisStatus, "failed_fallback");
    assert.strictEqual(result.analysisVersion, "local-semantic-v2");
    assert.strictEqual(grokCalls, 1);
    assert.strictEqual(geminiCalls, 1);
  });

  await run("Circuit breaker skips a provider mid-cooldown", async () => {
    // Trip the grok breaker with a single failure (threshold is 1).
    circuitBreaker.recordFailure("grok");
    assert.strictEqual(circuitBreaker.allow("grok"), false, "grok breaker should be open");

    stubGrok(async () => {
      throw providerError("grok", "rate_limit", 429, "should not be called");
    });
    stubGemini(() => validRaw({ aiMeta: { provider: "gemini", model: "gemini-1.5-flash" } }));

    const result = await aiAnalyzer.analyzeGrievance(INPUT);
    assert.strictEqual(result.aiProviderUsed, "gemini");
    assert.strictEqual(grokCalls, 0, "grok.extractFactors must NOT run while the breaker is open");
    assert.strictEqual(geminiCalls, 1);
  });

  await run("Grok success short-circuits before Gemini", async () => {
    stubGrok(() => validRaw({ aiMeta: { provider: "grok", model: "grok-3-mini" } }));
    stubGemini(async () => {
      throw new Error("Gemini should not be called when Grok succeeds");
    });

    const result = await aiAnalyzer.analyzeGrievance(INPUT);
    assert.strictEqual(result.aiProviderUsed, "grok");
    assert.strictEqual(result.analysisStatus, "ok");
    assert.strictEqual(result.aiMeta.provider, "grok");
    assert.strictEqual(grokCalls, 1);
    assert.strictEqual(geminiCalls, 0);
  });

  console.log(`\n${RESULTS.pass} passed, ${RESULTS.fail} failed`);
  process.exitCode = RESULTS.fail ? 1 : 0;
})();

