/**
 * grokProvider.js — xAI Grok adapter.
 *
 * Wraps the existing OpenAI-compatible chat/completions call (fetch to the URL
 * in AI_API_URL), and maps Grok's raw JSON envelope into the normalized
 * `aiFactors` shape that server/src/models/Problem.js expects.
 *
 * extractFactors(input) returns the normalized factors object (or throws a
 * typed provider error via providerError()).
 */
const { aiConfig } = require("../aiConfig");
const {
  buildAnalysisPrompt,
  extractJson,
  sanitizeAnalysis,
  validateAiFactors,
} = require("../analyzeHelpers");
const { providerError } = require("../providerError");

const PROVIDER = "grok";

function classifyHttpStatus(status) {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "quota_exceeded";
  if (status === 408 || status === 503 || status === 504) return "timeout";
  if (status >= 500) return "other";
  return "invalid_response";
}

async function extractFactors(input) {
  const cfg = aiConfig();
  const key = cfg.xaiKey;
  if (!key) {
    throw providerError(PROVIDER, "other", 500, "Grok key (XAI_API_KEY / AI_API_KEY) is not set");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  let response;
  try {
    response = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        max_tokens: 900,
        messages: [
          { role: "system", content: "You classify civic grievances and always reply with only valid JSON." },
          { role: "user", content: buildAnalysisPrompt(input) },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw providerError(PROVIDER, "timeout", 408, "Grok request timed out");
    }
    throw providerError(PROVIDER, "other", 0, `Grok request failed: ${err && err.message ? err.message : err}`);
  } finally {
    clearTimeout(timer);
  }

  const body = await response.text().catch(() => "");

  if (!response.ok) {
    const errorType = classifyHttpStatus(response.status);
    const snippet = body.slice(0, 200);
    throw providerError(
      PROVIDER,
      errorType,
      response.status,
      `Grok HTTP ${response.status}${snippet ? ` — ${snippet}` : ""}`
    );
  }

  let envelope;
  try {
    envelope = JSON.parse(body);
  } catch {
    throw providerError(PROVIDER, "invalid_response", response.status, "Grok returned non-JSON envelope");
  }

  const msg = envelope && envelope.choices && envelope.choices[0] && envelope.choices[0].message;
  if (!msg || !msg.content) {
    throw providerError(PROVIDER, "invalid_response", response.status, "Grok returned empty content");
  }

  const raw = extractJson(msg.content);
  const analysis = sanitizeAnalysis(raw, input);
  validateAiFactors(analysis);
  analysis.aiMeta = { provider: PROVIDER, model: cfg.model, analyzedAt: new Date() };
  return analysis;
}

module.exports = { extractFactors };
