const mongoose = require("mongoose");

const emailOtpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  // SHA-256 hash of the 6-digit code, never the plaintext code itself --
  // same reasoning as not storing plaintext passwords.
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  lastSentAt: { type: Date, default: Date.now },
  // MongoDB deletes the document automatically once this timestamp passes --
  // no cron job needed to clean up expired/used codes.
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});

module.exports = mongoose.model("EmailOtp", emailOtpSchema);
