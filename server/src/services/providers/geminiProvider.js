/**
 * geminiProvider.js — Google Gemini adapter.
 *
 * Uses the official @google/generative-ai SDK (GoogleGenerativeAI client),
 * NOT a hand-rolled fetch against the REST endpoint, so we don't have to
 * maintain their auth schema/headers. Gemini's request/response shape differs
 * from Grok's, but this adapter maps the result into the SAME normalized
 * `aiFactors` shape the other adapter returns, so the caller never needs to
 * know which provider ran.
 *
 *   extractFactors(input) -> normalized aiFactors object | throws typed error
 */
const { aiConfig } = require("../aiConfig");
const {
  buildAnalysisPrompt,
  extractJson,
  sanitizeAnalysis,
  validateAiFactors,
} = require("../analyzeHelpers");
const { providerError } = require("../providerError");

const PROVIDER = "gemini";

function classifyError(err) {
  const status = Number(err && err.status) || 0;
  if (status === 429) return { errorType: "rate_limit", status };
  if (status === 401 || status === 403) return { errorType: "quota_exceeded", status };
  if (status === 408 || status === 503 || status === 504) return { errorType: "timeout", status };
  if (/timed out|timeout/i.test(err && err.message)) return { errorType: "timeout", status: status || 408 };
  if (status >= 500) return { errorType: "other", status };
  return { errorType: "invalid_response", status: status || 200 };
}

async function extractFactors(input) {
  // Lazy require so the server still boots if the SDK isn't installed; the
  // orchestrator gates real usage on isAiConfigured('gemini') anyway.
  let GenAI;
  try {
    // eslint-disable-next-line global-require
    GenAI = require("@google/generative-ai");
  } catch (err) {
    throw providerError(PROVIDER, "other", 500, "@google/generative-ai SDK is not installed");
  }

  const cfg = aiConfig();
  const key = cfg.geminiKey;
  if (!key) {
    throw providerError(PROVIDER, "other", 500, "Gemini key (GEMINI_API_KEY) is not set");
  }

  const client = new GenAI.GoogleGenerativeAI(key);
  const model = client.getGenerativeModel({ model: cfg.geminiModel });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  let result;
  try {
    // @google/generative-ai v0.24.x: generateContent(request, requestOptions).
    // signal/timeout live on the SECOND argument so a hung call is actually
    // aborted instead of waiting on the SDK's default timeout.
    result = await model.generateContent(
      {
        contents: [
          {
            role: "user",
            parts: [{ text: buildAnalysisPrompt(input) }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 900,
        },
      },
      {
        signal: controller.signal,
        timeout: cfg.timeoutMs,
      }
    );
  } catch (err) {
    const { errorType, status } = classifyError(err);
    throw providerError(
      PROVIDER,
      errorType,
      status,
      `Gemini request failed: ${err && err.message ? err.message : err}`
    );
  } finally {
    clearTimeout(timer);
  }

  let text;
  try {
    const response = result.response;
    text = typeof response.text === "function" ? response.text() : response && response.text ? response.text : "";
  } catch (err) {
    throw providerError(PROVIDER, "invalid_response", 200, `Gemini response could not be read: ${err && err.message ? err.message : err}`);
  }

  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw providerError(PROVIDER, "invalid_response", 200, "Gemini returned empty content");
  }

  const raw = extractJson(trimmed);
  const analysis = sanitizeAnalysis(raw, input);
  validateAiFactors(analysis);
  analysis.aiMeta = { provider: PROVIDER, model: cfg.geminiModel, analyzedAt: new Date() };
  return analysis;
}

module.exports = { extractFactors };
