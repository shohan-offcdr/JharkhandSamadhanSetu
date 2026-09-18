const mongoose = require("mongoose");

/**
 * Login accounts for the staffed portals.
 *
 * The citizen flow deliberately does NOT use this model: it stays on OTP (see
 * models/EmailOtp.js + models/Citizen.js) because most citizens will not have
 * a password. This model covers the three roles that sign in with credentials:
 * government nodal officers, startup/enterprise partners, and admins.
 *
 * `identifier` is an email address and is unique per role, so the same address
 * can hold a government and a startup account during a demo (the seed script
 * does not do that, but the student portal and the startup portal share pages,
 * so the flexibility is worth the extra index).
 */
const ACCOUNT_ROLES = ["government", "startup", "student", "admin"];
const ACCOUNT_STATUS = ["active", "suspended"];

const accountSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ACCOUNT_ROLES, required: true, index: true },
    identifier: { type: String, required: true, lowercase: true, trim: true },
    // "scrypt$<salt>$<hash>" -- see utils/password.js. Never returned to a client.
    passwordHash: { type: String, required: true },
    name: { type: String, trim: true },
    designation: { type: String, trim: true },
    organisation: { type: String, trim: true },
    district: { type: String, trim: true },
    phone: { type: String, trim: true },
    status: { type: String, enum: ACCOUNT_STATUS, default: "active" },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

accountSchema.index({ identifier: 1, role: 1 }, { unique: true, name: "identifier_role_unique" });

accountSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret._id;
    delete ret.__v;
    // The hash must never leave the server, so the transform strips it instead
    // of every route remembering to project it away.
    delete ret.passwordHash;
    return ret;
  },
});

module.exports = mongoose.model("Account", accountSchema);
module.exports.ACCOUNT_ROLES = ACCOUNT_ROLES;
module.exports.ACCOUNT_STATUS = ACCOUNT_STATUS;