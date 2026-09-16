const express = require("express");
const crypto = require("crypto");
const EmailOtp = require("../models/EmailOtp");
const Citizen = require("../models/Citizen");
const resend = require("../config/resend");
const { generateSixDigitCode, hashCode } = require("../utils/otp");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

const RESEND_COOLDOWN_MS = 30 * 1000;
const EXPIRY_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isProduction = process.env.NODE_ENV === "production";

// Resend's shared test sender (onboarding@resend.dev) only delivers to the
// address that owns the Resend account -- every other recipient is rejected by
// the provider. That is the single most common reason a fresh clone of this
// project cannot send an OTP, so it's called out explicitly instead of leaving
// the operator to decode a provider error.
const usingResendSandbox = /@resend\.dev\b/i.test(process.env.EMAIL_FROM || "");
const SANDBOX_HINT =
  " (EMAIL_FROM is Resend's test sender, which only delivers to the Resend account owner's address. " +
  "Verify a domain, or send to that address.)";

// Constant-time comparison: a plain !== leaks how many leading characters of the
// stored hash matched.
function hashesMatch(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  // timingSafeEqual throws when the lengths differ, so check that first.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Provider errors are useful while a deployment is being set up, but shouldn't
// be handed to members of the public.
function providerDetail(error) {
  if (isProduction) return undefined;
  return error && (error.message || String(error));
}

if (usingResendSandbox) {
  console.warn(
    "[auth] EMAIL_FROM is Resend's shared test sender: OTP e-mails will only be delivered to the " +
      "Resend account owner's address. Verify a domain before relying on email OTP."
  );
}

// POST /api/auth/send-email-otp   body: { email }
router.post(
  "/send-email-otp",
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "कृपया मान्य ईमेल दर्ज करें / Enter a valid email address" });
    }
    if (!process.env.RESEND_API_KEY) {
      return res.status(503).json({
        error: "ईमेल OTP सेवा कॉन्फ़िगर नहीं है (RESEND_API_KEY गायब है) / Email OTP is not configured (RESEND_API_KEY is missing)",
      });
    }

    const existing = await EmailOtp.findOne({ email });
    if (existing && Date.now() - existing.lastSentAt.getTime() < RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - existing.lastSentAt.getTime())) / 1000);
      return res.status(429).json({ error: `कृपया ${waitSec} सेकंड प्रतीक्षा करें / Please wait ${waitSec}s before requesting another code` });
    }

    const code = generateSixDigitCode();
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: "आपका सत्यापन कोड / Your verification code",
      html: `
        <div style="font-family: sans-serif; max-width: 420px; margin: 0 auto;">
          <h2 style="color:#17213A;">झारखंड समाधान सेतु</h2>
          <p>आपका सत्यापन कोड / Your verification code is:</p>
          <p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color:#17213A;">${code}</p>
          <p style="color:#5B5847; font-size: 13px;">यह कोड 10 मिनट में समाप्त हो जाएगा / This code expires in 10 minutes.</p>
        </div>`,
    });

    if (error) {
      console.error("[auth] Resend rejected OTP email:", error.message || error);
      return res.status(502).json({
        error:
          "ईमेल OTP अभी नहीं भेजा जा सका। Resend में verified recipient/domain सेट करें। / " +
          "Email OTP could not be sent. Configure a verified Resend recipient or domain." +
          (usingResendSandbox ? SANDBOX_HINT : ""),
        detail: providerDetail(error),
      });
    }

    // Store the OTP only after the provider accepts the message. This avoids
    // blocking a retry when Resend rejects a sandbox recipient or sender.
    await EmailOtp.findOneAndUpdate(
      { email },
      { email, codeHash: hashCode(code), attempts: 0, lastSentAt: new Date(), expiresAt: new Date(Date.now() + EXPIRY_MS) },
      { upsert: true, setDefaultsOnInsert: true }
    );

    res.json({ sent: true });
  })
);

// POST /api/auth/verify-email-otp   body: { email, code }
router.post(
  "/verify-email-otp",
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const code = String(req.body.code || "").trim();

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "कृपया मान्य ईमेल दर्ज करें / Enter a valid email address" });
    }
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "कृपया 6 अंकों का OTP दर्ज करें / Enter a valid 6-digit OTP" });
    }

    const record = await EmailOtp.findOne({ email });
    if (!record) {
      return res.status(400).json({ error: "OTP समाप्त हो गया, नया OTP भेजें / OTP expired or not found, request a new one" });
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      await EmailOtp.deleteOne({ _id: record._id });
      return res.status(400).json({ error: "OTP समाप्त हो गया, नया OTP भेजें / OTP expired, request a new one" });
    }

    if (record.attempts >= MAX_ATTEMPTS) {
      await EmailOtp.deleteOne({ _id: record._id });
      return res.status(429).json({ error: "बहुत अधिक गलत प्रयास, नया OTP भेजें / Too many incorrect attempts, request a new OTP" });
    }

    if (!hashesMatch(hashCode(code), record.codeHash)) {
      record.attempts += 1;
      await record.save();
      const remaining = MAX_ATTEMPTS - record.attempts;
      return res.status(400).json({ error: `गलत OTP, ${remaining} प्रयास शेष / Incorrect OTP, ${remaining} attempt(s) left` });
    }

    // Persist the account before consuming the code. If the database has a
    // transient error, the user can retry instead of losing a valid OTP.
    const citizen = await Citizen.findOneAndUpdate(
      { email },
      { $setOnInsert: { email } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    // Single use -- a correct code is deleted only once the account is persisted.
    await EmailOtp.deleteOne({ _id: record._id });
    res.json({ verified: true, email, citizen: citizen.toJSON() });
  })
);

module.exports = router;
