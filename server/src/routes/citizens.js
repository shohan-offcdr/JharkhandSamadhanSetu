const express = require("express");
const Citizen = require("../models/Citizen");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 120;

// Returns an E.164 number, or null when the input cannot be a mobile number.
// The old version handed back whatever it was given whenever the digits didn't
// fit the expected shapes, so a typo silently created an account keyed on junk.
function normalizePhone(phone) {
  if (phone === undefined || phone === null || String(phone).trim() === "") return undefined;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9]/.test(digits.slice(2))) return `+${digits}`;
  const e164 = String(phone).trim();
  if (/^\+\d{8,15}$/.test(e164)) return e164; // already E.164 (e.g. from Firebase)
  return null;
}

// POST /api/citizens/find-or-create
// body: { name?, email?, phone? } -- at least one of email/phone is required.
// Used after a successful OTP verification (email or mobile) on both the
// register and login pages, so "logging in" and "registering" converge on
// the same real account instead of needing two separate systems.
router.post(
  "/find-or-create",
  asyncHandler(async (req, res) => {
    const name = req.body.name ? String(req.body.name).trim().slice(0, MAX_NAME_LENGTH) : undefined;
    const email = req.body.email ? String(req.body.email).trim().toLowerCase() : undefined;
    const phone = normalizePhone(req.body.phone);

    if (email && !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "कृपया मान्य ईमेल दर्ज करें / Enter a valid email address" });
    }
    if (phone === null) {
      return res.status(400).json({ error: "कृपया मान्य 10 अंकों का मोबाइल नंबर दर्ज करें / Enter a valid 10-digit mobile number" });
    }
    if (!email && !phone) {
      return res.status(400).json({ error: "email या phone आवश्यक है / email or phone is required" });
    }

    const query = email ? { email } : { phone };
    let citizen = await Citizen.findOne(query);
    let isNewAccount = false;

    if (!citizen) {
      try {
        citizen = await Citizen.create({ name, email, phone });
        isNewAccount = true;
      } catch (err) {
        // A double-tapped "Login" can race two creates. The unique index rejects
        // the second one -- return the record the first request created instead of
        // telling the citizen that their own account is already registered.
        if (err.code !== 11000) throw err;
        citizen = await Citizen.findOne(query);
        if (!citizen) throw err;
      }
    } else if (name && !citizen.name) {
      // Filling in a name for an account that was auto-created via a bare login.
      citizen.name = name;
      await citizen.save();
    }

    res.json({ ...citizen.toJSON(), isNewAccount });
  })
);

module.exports = router;
