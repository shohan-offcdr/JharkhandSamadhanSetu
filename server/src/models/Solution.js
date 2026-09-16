const mongoose = require("mongoose");

const SOLUTION_STATUS = ["Submitted", "Under Review", "Shortlisted", "Rejected"];

const solutionSchema = new mongoose.Schema(
  {
    // Human-facing ID like "SL-2026-12345", distinct from Mongo's _id so the
    // frontend can display it just like grievance JH-* IDs.
    id: { type: String, required: true, unique: true, index: true },
    // Human Problem.id this solution answers (e.g. JH-2026-12345), not _id.
    problemId: { type: String, required: true, index: true, trim: true },
    // Session identifier (email/phone) from API.getSession(); optional so
    // anonymous demos don't fail validation.
    studentId: { type: String, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    summary: { type: String, required: true, trim: true, maxlength: 5000 },
    approach: { type: String, trim: true, maxlength: 5000 },
    techStack: { type: String, trim: true, maxlength: 500 },
    timelineDays: { type: Number, min: 1, max: 3650 },
    team: { type: String, trim: true, maxlength: 500 },
    status: { type: String, enum: SOLUTION_STATUS, default: "Submitted" },
  },
  { timestamps: true }
);

solutionSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Solution", solutionSchema);
module.exports.SOLUTION_STATUS = SOLUTION_STATUS;
