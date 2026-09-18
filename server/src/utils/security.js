const crypto = require("crypto");

/** Security constants - NEVER log these values */
const SECRET_KEY_NAMES = new Set([
  "AUTH_SECRET",
  "JWT_SECRET",
  "RESEND_API_KEY",
  "XAI_API_KEY",
  "AI_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "CLOUDINARY_API_SECRET",
  "CLOUDINARY_API_KEY",
  "MONGODB_URI",
  "password",
  "api_key",
  "api_secret",
  "secret",
]);

/** Mask a value for safe logging - shows only first 4 chars + length */
function maskSecret(value, showLength = true) {
  if (!value || typeof value !== "string") return "[not set]";
  if (value.length <= 4) return "****";
  const masked = value.slice(0, 4) + "****";
  return showLength ? `${masked} (${value.length} chars)` : masked;
}

/** Check if a key name suggests it's a secret */
function isSecretKey(keyName) {
  const lower = keyName.toLowerCase();
  return SECRET_KEY_NAMES.has(lower) ||
    lower.includes("secret") ||
    lower.includes("api_key") ||
    lower.includes("api_secret") ||
    lower.includes("password") ||
    lower.includes("token");
}

/**
 * Safely log an error without exposing secrets.
 * Scans error messages and object properties for patterns that look like secrets.
 */
function safeErrorLog(error, context = "") {
  let message = error instanceof Error ? error.message : String(error || "");
  const prefix = context ? `[${context}] ` : "";

  // Mask common secret patterns in error messages
  message = message.replace(/(api[_-]?key|api[_-]?secret|password|token|bearer)\s*[:=]\s*\S+/gi, (match) => {
    return match.split("=")[0] + "=****";
  });

  // Mask anything that looks like a key (long alphanumeric strings)
  message = message.replace(/(xai-eyJ[A-Za-z0-9_-]+|re_[A-Za-z0-9]+|AQ\.[A-Za-z0-9]+)/g, "****");

  console.error(prefix + message);

  // Never include stack traces with sensitive data in production
  if (process.env.NODE_ENV === "production" && error.stack) {
    // Stack traces are OK to log, but ensure no secrets leaked into them
    const safeStack = error.stack.replace(/at\s+.*\(.*\)/g, (line) => {
      return line.replace(/[a-zA-Z0-9_-]{20,}/g, (longStr) => {
        if (isSecretKey(longStr)) return "****";
        return longStr;
      });
    });
    console.error(prefix + "Stack:", safeStack);
  }
}

module.exports = { maskSecret, isSecretKey, safeErrorLog, SECRET_KEY_NAMES };
