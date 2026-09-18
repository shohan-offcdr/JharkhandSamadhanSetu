const mongoose = require("mongoose");

/**
 * Industry partners and their CSR commitments.
 *
 * Backs the government portal's Industry-CSR page: the committed CSR amount,
 * active project count, compliance status and designated testbeds are all real
 * fields now instead of table markup.
 */
const CSR_COMPLIANCE_STATUS = ["Compliant", "Compliance Pending", "Under Review", "Suspended"];

const enterpriseCsrSchema = new mongoose.Schema(
  {
    // Human-facing id like "CSR-2026-31544".
    id: { type: String, required: true, unique: true, index: true },
    enterpriseName: { type: String, required: true, trim: true, maxlength: 300 },
    sector: { type: String, trim: true, maxlength: 160 },
    // Rupees (not lakhs): keeps one unit across API, seed and UI formatting.
    committedAmount: { type: Number, default: 0, min: 0 },
    activeProjects: { type: Number, default: 0, min: 0 },
    complianceStatus: { type: String, enum: CSR_COMPLIANCE_STATUS, default: "Compliance Pending" },
    // Physical testbeds/sites the partner has offered for pilot deployment.
    testbeds: [
      {
        name: { type: String, trim: true },
        location: { type: String, trim: true },
      },
    ],
    contactEmail: { type: String, trim: true, lowercase: true },
    contactName: { type: String, trim: true },
    district: { type: String, trim: true },
    notes: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

enterpriseCsrSchema.index({ sector: 1, complianceStatus: 1 });

enterpriseCsrSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret._id;
    delete ret.__v;
    (ret.testbeds || []).forEach((testbed) => delete testbed._id);
    return ret;
  },
});

module.exports = mongoose.model("EnterpriseCsr", enterpriseCsrSchema);
module.exports.CSR_COMPLIANCE_STATUS = CSR_COMPLIANCE_STATUS;
