const mongoose = require("mongoose");

/**
 * The organisation profile behind a startup/enterprise account.
 *
 * Keyed by the Account `identifier` (email) so the startup portal can load and
 * save its own profile without a second login. Every section of the Company
 * Profile page maps to a field here: identity, sectors, capabilities/equipment,
 * capacity & investment scale, and past supported projects.
 */
const startupProfileSchema = new mongoose.Schema(
  {
    // Account.identifier of the partner this profile belongs to.
    identifier: { type: String, required: true, unique: true, lowercase: true, trim: true },
    companyName: { type: String, required: true, trim: true, maxlength: 300 },
    organisation: { type: String, trim: true, maxlength: 300 },
    // DPI/DigiLocker registration reference shown next to "Verified DPI Partner".
    dlpiNumber: { type: String, trim: true, maxlength: 120 },
    about: { type: String, trim: true, maxlength: 2000 },
    sectors: { type: [String], default: [] },
    capabilities: { type: [String], default: [] },
    labEquipment: { type: [String], default: [] },
    teamSize: { type: Number, min: 0 },
    // Free text on purpose: partners describe this as "5 MLD", "12 districts", etc.
    capacityPerYear: { type: String, trim: true, maxlength: 120 },
    investmentMin: { type: Number, min: 0 },
    investmentMax: { type: Number, min: 0 },
    districts: { type: [String], default: [] },
    website: { type: String, trim: true, maxlength: 300 },
    contactEmail: { type: String, trim: true, lowercase: true },
    contactPhone: { type: String, trim: true },
    // Feature 2: structured profile object — the matching-engine input.
    profile: {
      interests: { type: [String], default: [] },
      sectors: { type: [String], default: [] },
      stage: { type: String, trim: true, maxlength: 60 },
      capacity: { type: String, trim: true, maxlength: 120 },
      pastProjects: { type: [String], default: [] },
    },
    pastProjects: [
      {
        title: { type: String, trim: true },
        district: { type: String, trim: true },
        year: { type: Number },
        outcome: { type: String, trim: true },
      },
    ],
  },
  { timestamps: true }
);

startupProfileSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret._id;
    delete ret.__v;
    (ret.pastProjects || []).forEach((project) => delete project._id);
    return ret;
  },
});

module.exports = mongoose.model("StartupProfile", startupProfileSchema);
