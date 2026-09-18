const crypto = require("crypto");

/**
 * Password hashing for the government / startup accounts.
 *
 * scrypt is used straight from `node:crypto` on purpose: it is a memory-hard
 * KDF that ships with Node, so the server keeps storing real password hashes
 * without pulling in bcrypt/argon2 (and their native build steps) for a demo
 * deployment.
 *
 * Stored format: "scrypt$<salt-hex>$<derived-key-hex>" -- the algorithm and the
 * salt live inside the hash, so a future switch to another KDF can verify old
 * hashes and re-hash on next login instead of locking users out.
 */
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;
const MIN_PASSWORD_LENGTH = 8;

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES).toString("hex");
  const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

// Constant-time comparison, same reasoning as auth.js#hashesMatch: a plain !==
// leaks how many leading characters of the stored hash matched.
function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expected] = parts;
  const expectedBuffer = Buffer.from(expected, "hex");
  if (!expectedBuffer.length) return false;
  const derived = crypto.scryptSync(String(password === undefined || password === null ? "" : password), salt, SCRYPT_KEYLEN);
  return derived.length === expectedBuffer.length && crypto.timingSafeEqual(derived, expectedBuffer);
}

module.exports = { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH };