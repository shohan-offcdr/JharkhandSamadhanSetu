const mongoose = require("mongoose");

const STATUS_VALUES = ["Pending Verification", "Verified", "Escalated", "Rejected", "Resolved"];

const problemSchema = new mongoose.Schema(
  {
    // Human-facing ID like "JH-2024-10312", kept distinct from Mongo's _id
    // so the frontend's existing ID format (already in localStorage demos,
    // already printed on citizen confirmation screens) doesn't have to change.
    id: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true },
    titleHi: { type: String, trim: true },
    category: { type: String, required: true },
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
    priorityScore: { type: Number, default: 0 },
    analysisVersion: { type: String, default: "local-semantic-v1" },
    status: { type: String, enum: STATUS_VALUES, default: "Pending Verification" },
    createdAt: { type: String }, // kept as YYYY-MM-DD string to match existing frontend display code
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

problemSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Problem", problemSchema);
module.exports.STATUS_VALUES = STATUS_VALUES;
