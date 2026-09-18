const mongoose = require("mongoose");

const STATUS_VALUES = ["Pending Verification", "Verified", "Escalated", "Rejected", "Resolved"];

const PRIORITY_LABELS = ["Critical", "High", "Medium", "Low"];

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
    analysisStatus: { type: String, enum: ["ok", "failed_fallback"], default: "ok" },
    aiProviderUsed: { type: String, enum: ["grok", "gemini", "local_rules"], default: "local_rules" },
    // Student portal only lists visible problems. Auto-approved on AI analysis
    // so new grievances appear immediately; moderators can hide via status route.
    visibleToStudents: { type: Boolean, default: true },
    status: { type: String, enum: STATUS_VALUES, default: "Pending Verification" },
    createdAt: { type: String }, // kept as YYYY-MM-DD string to match existing frontend display code
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

problemSchema.index({ visibleToStudents: 1, priorityScore: -1 });
problemSchema.index({ category: 1, district: 1 });

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

