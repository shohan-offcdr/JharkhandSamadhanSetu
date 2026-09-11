const mongoose = require("mongoose");

const citizenSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true, sparse: true, unique: true },
    phone: { type: String, trim: true, sparse: true, unique: true }, // stored as +91XXXXXXXXXX
  },
  { timestamps: true }
);

citizenSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Citizen", citizenSchema);
