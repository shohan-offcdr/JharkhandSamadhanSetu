const mongoose = require("mongoose");

/**
 * One partner's engagement against one grievance.
 *
 * This single collection covers the whole startup lifecycle so the portal does
 * not need four parallel tables:
 *  - an "Interest" is created the moment a partner flags a problem,
 *  - the stage moves through Under Review -> Funding Matched -> In Field,
 *  - milestones carry the project-tracking ledger,
 *  - messages carry the consortium communication thread,
 *  - agreements carry the IP/agreement tracker,
 *  - fundingCommitted carries the escrow/funding-vault total.
 */
const COLLAB_TYPES = ["Interest", "CSR", "R&D", "Pilot", "Funding"];
const COLLAB_STAGES = ["Interest", "Under Review", "Funding Matched", "In Field", "Completed", "Declined"];
const MILESTONE_STATUS = ["Pending", "In Progress", "Completed", "Blocked"];

const milestoneSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 300 },
    dueDate: { type: String, trim: true }, // kept as a display string, like Problem.createdAt
    status: { type: String, enum: MILESTONE_STATUS, default: "Pending" },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    note: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    author: { type: String, trim: true },
    role: { type: String, trim: true },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const agreementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 300 },
    status: { type: String, trim: true },
    reference: { type: String, trim: true, maxlength: 200 },
  },
  { _id: false }
);

const collaborationSchema = new mongoose.Schema(
  {
    // Human-facing id like "COL-2026-73210".
    id: { type: String, required: true, unique: true, index: true },
    problemId: { type: String, required: true, index: true, trim: true },
    solutionId: { type: String, trim: true },
    // Account.identifier of the partner (startup/enterprise) that engaged.
    partnerId: { type: String, required: true, lowercase: true, trim: true, index: true },
    partnerName: { type: String, trim: true, maxlength: 300 },
    universityId: { type: String, trim: true },
    universityName: { type: String, trim: true, maxlength: 300 },
    type: { type: String, enum: COLLAB_TYPES, default: "Interest" },
    stage: { type: String, enum: COLLAB_STAGES, default: "Interest" },
    title: { type: String, trim: true, maxlength: 300 },
    summary: { type: String, trim: true, maxlength: 4000 },
    fundingCommitted: { type: Number, default: 0, min: 0 },
    milestones: { type: [milestoneSchema], default: [] },
    messages: { type: [messageSchema], default: [] },
    agreements: { type: [agreementSchema], default: [] },
  },
  { timestamps: true }
);

collaborationSchema.index({ stage: 1, createdAt: -1 });

collaborationSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Collaboration", collaborationSchema);
module.exports.COLLAB_TYPES = COLLAB_TYPES;
module.exports.COLLAB_STAGES = COLLAB_STAGES;
module.exports.MILESTONE_STATUS = MILESTONE_STATUS;
