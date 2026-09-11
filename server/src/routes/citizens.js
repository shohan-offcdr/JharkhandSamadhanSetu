const express = require("express");
const Citizen = require("../models/Citizen");

const router = express.Router();

function normalizePhone(phone) {
  if (!phone) return undefined;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return phone; // already E.164-ish (e.g. from Firebase), leave as-is
}

// POST /api/citizens/find-or-create
// body: { name?, email?, phone? } -- at least one of email/phone is required.
// Used after a successful OTP verification (email or mobile) on both the
// register and login pages, so "logging in" and "registering" converge on
// the same real account instead of needing two separate systems.
router.post("/find-or-create", async (req, res) => {
  const name = req.body.name ? String(req.body.name).trim() : undefined;
  const email = req.body.email ? String(req.body.email).trim().toLowerCase() : undefined;
  const phone = normalizePhone(req.body.phone);

  if (!email && !phone) {
    return res.status(400).json({ error: "email या phone आवश्यक है / email or phone is required" });
  }

  try {
    const query = email ? { email } : { phone };
    let citizen = await Citizen.findOne(query);
    let isNewAccount = false;

    if (!citizen) {
      citizen = await Citizen.create({ name, email, phone });
      isNewAccount = true;
    } else if (name && !citizen.name) {
      // Filling in a name for an account that was auto-created via bare login before.
      citizen.name = name;
      await citizen.save();
    }

    res.json({ ...citizen.toJSON(), isNewAccount });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "यह ईमेल/मोबाइल पहले से पंजीकृत है / This email/mobile is already registered" });
    }
    console.error("[citizens] find-or-create failed:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
