const mongoose = require("mongoose");
const { priorityTierFor } = require("../utils/categorize");

const STATUS_VALUES = ["Pending Verification", "Verified", "Escalated", "Rejected", "Resolved"];

const PRIORITY_LABELS = ["Critical", "High", "Medium", "Low"];

// Lowercase tier used for the Student Portal badge and for machine-readable
// sorting/filtering (priorityLabel stays the human sentence-case label the
// existing dashboards already render).
const PRIORITY_TIERS = ["low", "medium", "high", "critical"];

// Feature 1 lifecycle. 'pending' = queued for AI factor extraction, 'done' = the
// provider answered and the factors were validated, 'failed_fallback' = the
// factors came from Local Rules instead (provider down / rate-limited / not
// configured / off-spec JSON). 'ok' is kept in the enum because rows written
// before Feature 1 (and the classification path in POST /:id/reanalyze) use it.
const ANALYSIS_STATUS_VALUES = ["pending", "done", "failed_fallback", "ok"];

const EVIDENCE_QUALITY_VALUES = ["none", "weak", "moderate", "strong"];
const AI_FACTOR_SOURCE_VALUES = ["llm", "local_rules", "inherited"];

const problemSchema = new mongoose.Schema(
  {
    // Human-facing ID like "JH-2024-10312", kept distinct from Mongo's _id
    // so the frontend's existing ID format (already in localStorage demos,
    // already printed on citizen confirmation screens) doesn't have to change.
    id: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true },
    titleHi: { type: String, trim: true },
    category: { type: String, required: true },
    categoryConfidence: { type: Number, min: 0, max: 1 },
    district: { type: String, required: true },
    block: { type: String },
    gramPanchayat: { type: String },
    pincode: { type: String },
    landmark: { type: String },
    gpsLat: { type: Number },
    gpsLng: { type: Number },
    evidenceFileName: { type: String },
    scaleOfImpact: {
      type: String,
      enum: ["Individual Household", "Specific Neighbourhood", "Village", "Multiple Villages", "Entire District"],
    },
    durationDays: { type: Number, default: 0 },
    description: { type: String, required: true },
    // Original citizen text is never overwritten. The AI/student-facing rewrite
    // lives in enrichedDescription + problemStatement below.
    enrichedDescription: { type: String, trim: true },
    problemStatement: { type: String, trim: true },
    photos: [
      {
        url: String,
        publicId: String,
        width: Number,
        height: Number,
        bytes: Number,
      },
    ],
    reportCount: { type: Number, default: 1 },
    duplicateOf: { type: String },
    similarity: { type: Number, min: 0, max: 1 },
    mergedIds: { type: [String], default: [] },
    priorityScore: { type: Number, default: 0 },
    priorityLabel: { type: String, enum: PRIORITY_LABELS },
    priorityReasons: { type: [String], default: [] },
    analysisVersion: { type: String, default: "local-semantic-v1" },
    aiMeta: {
      provider: { type: String },
      model: { type: String },
      analyzedAt: { type: Date },
    },
    // Which provider actually served the analysis ('grok' | 'gemini' |
    // 'local_rules') and whether all AI providers failed over ('failed_fallback').
    // Read from server via GET /api/problems — never from the browser.
    analysisStatus: { type: String, enum: ANALYSIS_STATUS_VALUES, default: "pending" },
    // "pending" is written by POST /api/problems while the background analysis
    // job is queued (see services/analysisQueue.js) — it must be an allowed
    // value or every new submission fails validation.
    aiProviderUsed: { type: String, enum: ["grok", "gemini", "local_rules", "pending"], default: "local_rules" },
    // ---- Feature 1: AI priority factor extraction -------------------------
    // Structured factors extracted by Grok (validated against
    // services/aiFactors.js before they are ever written) or, on any failure, by
    // Local Rules. `source` records which, so a fallback is never mistaken for a
    // model answer.
    aiFactors: {
      urgencyScore: { type: Number, min: 0, max: 100, default: 0 },
      estimatedAffectedPeople: { type: Number, min: 0, default: 0 },
      categoryRiskConfidence: { type: Number, min: 0, max: 1, default: 0 },
      evidenceQuality: { type: String, enum: EVIDENCE_QUALITY_VALUES, default: "none" },
      riskTags: { type: [String], default: [] },
      source: { type: String, enum: AI_FACTOR_SOURCE_VALUES, default: "local_rules" },
      provider: { type: String },
      model: { type: String },
    },
    // The score the AI factors alone justify (no citizen duration/reports/photo).
    aiPriorityScore: { type: Number, min: 0, max: 100, default: 0 },
    // The authoritative score: the deterministic formula fed with the citizen
    // inputs AND (where they are sparse) the AI factors. priorityScore mirrors
    // this value so the existing dashboards keep working unchanged.
    finalPriorityScore: { type: Number, min: 0, max: 100 },
    priorityTier: { type: String, enum: PRIORITY_TIERS },
    analyzedAt: { type: Date },
    // ---- Feature 2: matching engine ---------------------------------------
    // Vector embedding of (title + description + category). `select: false` keeps
    // 1536 floats out of every list response; matching queries ask for it
    // explicitly with .select("+embedding").
    embedding: { type: [Number], default: undefined, select: false },
    embeddingModel: { type: String, index: true },
    embeddedAt: { type: Date },
    // Student portal only lists visible problems. Auto-approved on AI analysis
    // so new grievances appear immediately; moderators can hide via status route.
    visibleToStudents: { type: Boolean, default: true },
    status: { type: String, enum: STATUS_VALUES, default: "Pending Verification" },
    createdAt: { type: String }, // kept as YYYY-MM-DD string to match existing frontend display code
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

problemSchema.index({ visibleToStudents: 1, priorityScore: -1 });
problemSchema.index({ visibleToStudents: 1, finalPriorityScore: -1 });
problemSchema.index({ category: 1, district: 1 });

// Keeps the derived priority fields populated on every path that uses .save().
// finalPriorityScore is authoritative when a caller sets it (the AI analysis
// pipeline does); otherwise it inherits priorityScore so legacy writes and the
// /reanalyze route can never leave a row without a tier. updateOne/findOneAndUpdate
// bypass this hook, so those call sites set both fields explicitly.
problemSchema.pre("save", function syncPriorityDerivatives(next) {
  if (this.finalPriorityScore === undefined || this.finalPriorityScore === null) {
    this.finalPriorityScore = Number(this.priorityScore) || 0;
  }
  if (!this.priorityTier) {
    this.priorityTier = priorityTierFor(this.finalPriorityScore);
  }
  next();
});

problemSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Problem", problemSchema);
module.exports.STATUS_VALUES = STATUS_VALUES;
module.exports.PRIORITY_LABELS = PRIORITY_LABELS;
module.exports.PRIORITY_TIERS = PRIORITY_TIERS;
module.exports.ANALYSIS_STATUS_VALUES = ANALYSIS_STATUS_VALUES;
module.exports.EVIDENCE_QUALITY_VALUES = EVIDENCE_QUALITY_VALUES;

