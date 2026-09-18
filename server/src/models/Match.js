/**
 * Match.js — Feature 2: startup ↔ problem match records.
 *
 * Stores the result of one generateMatches() run for one startup. Unique index
 * on (startupId, problemId) so a rerun replaces the old score without creating
 * duplicates.
 */
const mongoose = require("mongoose");

const matchSchema = new mongoose.Schema(
  {
    startupId: { type: String, required: true, index: true },
    problemId: { type: String, required: true, index: true },
    matchScore: { type: Number, min: 0, max: 100, required: true },
    reason: { type: String, trim: true, maxlength: 250 },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: false, updatedAt: false } }
);

// One row per (startup, problem). Reruns overwrite.
matchSchema.index({ startupId: 1, problemId: 1 }, { unique: true });

matchSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Match", matchSchema);
