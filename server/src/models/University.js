const mongoose = require("mongoose");

/**
 * Partner institutions that can be matched to a verified grievance.
 *
 * The government portal's Universities page used to render a hardcoded table;
 * this collection now backs those rows, including the accepted/active/completed
 * counters and the performance score shown in the "Performance" column.
 */
const UNIVERSITY_STATUS = ["Pending Verification", "Active", "Suspended"];

const universitySchema = new mongoose.Schema(
  {
    // Human-facing id like "UN-2026-40218", same shape as JH-*/SL-* ids.
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 300 },
    shortName: { type: String, trim: true, maxlength: 60 },
    district: { type: String, required: true, trim: true },
    // Research focus, e.g. ["Hydro-geology", "Embedded IoT"] -- matched against
    // a grievance's category when the officer looks for a partner.
    specializations: { type: [String], default: [] },
    coordinatorName: { type: String, trim: true },
    coordinatorEmail: { type: String, trim: true, lowercase: true },
    coordinatorPhone: { type: String, trim: true },
    acceptedCount: { type: Number, default: 0, min: 0 },
    activeCount: { type: Number, default: 0, min: 0 },
    completedCount: { type: Number, default: 0, min: 0 },
    // 0-100, shown as the completion/response score in the table.
    performanceScore: { type: Number, default: 0, min: 0, max: 100 },
    status: { type: String, enum: UNIVERSITY_STATUS, default: "Pending Verification" },
    notes: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

universitySchema.index({ district: 1, status: 1 });

universitySchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("University", universitySchema);
module.exports.UNIVERSITY_STATUS = UNIVERSITY_STATUS;
