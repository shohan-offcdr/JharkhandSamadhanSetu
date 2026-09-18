const crypto = require("crypto");

/**
 * Session tokens for the government / startup portals.
 *
 * The token is a signed, self-describing value: base64url(JSON payload) + "."
 * + HMAC-SHA256 signature. Nothing is trusted from the client beyond the
 * signature check, and there is no server-side session table to keep in sync,
 * so a restart does not sign everybody out.
 *
 * This is deliberately not a full JWT implementation -- it only needs to carry
 * {role, identifier, accountId} plus an expiry for this app, and staying with
 * `node:crypto` keeps the dependency list unchanged.
 */
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

let warnedAboutFallback = false;

function secret() {
  const value = process.env.AUTH_SECRET || process.env.JWT_SECRET;
  if (value) return value;

  // A production deployment must set its own secret. Everything else is a local
  // walkthrough of the demo, where refusing to issue a token would just look
  // like a broken login page.
  if (process.env.NODE_ENV === "production") {
    const error = new Error("AUTH_SECRET is not configured");
    error.status = 503;
    throw error;
  }
  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      "[token] AUTH_SECRET/JWT_SECRET is not set: using the local development fallback secret. " +
        "Set AUTH_SECRET before deploying."
    );
  }
  return "jss-local-development-secret";
}

function signToken(payload, ttlMs = DEFAULT_TTL_MS) {
  const now = Date.now();
  const body = { ...payload, iat: now, exp: now + ttlMs };
  const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

// Returns the payload, or null for anything tampered with, malformed or expired.
function verifyToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;

  const expected = crypto.createHmac("sha256", secret()).update(encoded).digest("base64url");
  const providedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
  return payload;
}

module.exports = { signToken, verifyToken, DEFAULT_TTL_MS };