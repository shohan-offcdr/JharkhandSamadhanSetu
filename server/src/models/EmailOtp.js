const mongoose = require("mongoose");

const emailOtpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  // SHA-256 hash of the 6-digit code, never the plaintext code itself --
  // same reasoning as not storing plaintext passwords.
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  lastSentAt: { type: Date, default: Date.now },
  // MongoDB deletes the document automatically once this timestamp passes --
  // no cron job needed to clean up expired/used codes.
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});

// One live code per address: the routes upsert on `email`, and without a unique
// constraint two near-simultaneous "send OTP" requests could insert two codes.
//
// The index is named explicitly rather than declared as `unique: true` on the
// field, because `unique: true` would ask MongoDB for an index called "email_1"
// -- and deployments created by an earlier version of this model already have a
// NON-unique "email_1". MongoDB refuses to redefine an index under the same
// name, which made index creation fail on those databases.
emailOtpSchema.index({ email: 1 }, { unique: true, name: "email_unique" });

module.exports = mongoose.model("EmailOtp", emailOtpSchema);
