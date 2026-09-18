/**
 * aiConfig.js — single source of truth for the AI provider configuration.
 *
 * Server-only: this module (and everything it reads) must never be imported
 * from site/ — that is where API keys must never leak.
 *
 * Env vars (all optional, all read from server/.env which is gitignored):
 *   XAI_API_KEY              Grok key (preferred; falls back to AI_API_KEY).
 *   AI_API_KEY               Legacy Grok key alias, kept for backward compat.
 *   GEMINI_API_KEY           Google Gemini key.
 *   AI_API_URL               Grok endpoint (OpenAI-compatible), default x.ai.
 *   AI_MODEL                 Grok model, default grok-3-mini.
 *   GEMINI_MODEL             Gemini model, default gemini-1.5-flash.
 *   AI_TIMEOUT_MS            Per-request timeout, default 15000.
 *   AI_PROVIDER_ORDER        Comma-separated fallback order, default "grok,gemini".
 */
const AI_PROVIDER_ORDER_DEFAULT = "grok,gemini";

function aiConfig() {
  return {
    url: process.env.AI_API_URL || "https://api.x.ai/v1/chat/completions",
    xaiKey: process.env.XAI_API_KEY || process.env.AI_API_KEY || "",
    geminiKey: process.env.GEMINI_API_KEY || "",
    model: process.env.AI_MODEL || "grok-3-mini",
    geminiModel: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 15000),
    provider: process.env.AI_PROVIDER || "xai",
    order: (process.env.AI_PROVIDER_ORDER || AI_PROVIDER_ORDER_DEFAULT)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
}

function isAiConfigured(provider) {
  const cfg = aiConfig();
  if (!provider || provider === "grok" || provider === "xai") {
    return Boolean(cfg.xaiKey);
  }
  if (provider === "gemini" || provider === "google") {
    return Boolean(cfg.geminiKey);
  }
  return false;
}

module.exports = { aiConfig, isAiConfigured, AI_PROVIDER_ORDER_DEFAULT };
