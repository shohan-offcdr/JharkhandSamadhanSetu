const crypto = require("crypto");

function generateSixDigitCode() {
  // 100000-999999, always 6 digits, no leading-zero ambiguity.
  return String(crypto.randomInt(100000, 1000000));
}

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

module.exports = { generateSixDigitCode, hashCode };
