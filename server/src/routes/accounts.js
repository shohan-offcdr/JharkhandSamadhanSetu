const express = require("express");
const Account = require("../models/Account");
const { ACCOUNT_ROLES } = require("../models/Account");
const { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } = require("../utils/password");
const { signToken } = require("../utils/token");
const requireAccount = require("../middleware/requireAccount");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 160;

function cleanText(value, maxLength = MAX_NAME_LENGTH) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, maxLength);
}

function normalizeIdentifier(value) {
  return cleanText(value, 160).toLowerCase();
}

// One generic message for "unknown account" and "wrong password": a different
// reply for each would let anyone enumerate which officer/partner addresses
// exist on the platform.
const BAD_CREDENTIALS = "अमान्य आईडी या पासवर्ड / Invalid ID or password";

// POST /api/accounts/register   body: { role, identifier, password, name?, designation?, organisation?, district? }
// Used by the startup "Register your enterprise" path and by the seed script.
router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const role = cleanText(req.body.role, 40).toLowerCase();
    const identifier = normalizeIdentifier(req.body.identifier);
    const password = String(req.body.password === undefined || req.body.password === null ? "" : req.body.password);

    if (!ACCOUNT_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${ACCOUNT_ROLES.join(", ")}` });
    }
    if (!EMAIL_RE.test(identifier)) {
      return res.status(400).json({ error: "कृपया मान्य ईमेल आईडी दर्ज करें / Enter a valid email ID" });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: `पासवर्ड कम से कम ${MIN_PASSWORD_LENGTH} अक्षरों का होना चाहिए / Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      });
    }

    const existing = await Account.findOne({ identifier, role });
    if (existing) {
      return res.status(409).json({ error: "यह आईडी पहले से पंजीकृत है / This ID is already registered" });
    }

    let account;
    try {
      account = await Account.create({
        role,
        identifier,
        passwordHash: hashPassword(password),
        name: cleanText(req.body.name) || undefined,
        designation: cleanText(req.body.designation) || undefined,
        organisation: cleanText(req.body.organisation) || undefined,
        district: cleanText(req.body.district, 80) || undefined,
      });
    } catch (err) {
      // A double-submitted signup races two creates; the unique index rejects the
      // second one, and the honest answer is "already registered" rather than a 500.
      if (err.code === 11000) {
        return res.status(409).json({ error: "यह आईडी पहले से पंजीकृत है / This ID is already registered" });
      }
      throw err;
    }

    res.status(201).json({
      token: signToken({ role: account.role, identifier: account.identifier, accountId: account.id }),
      account: account.toJSON(),
    });
  })
);

// POST /api/accounts/login   body: { role, identifier, password }
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const role = cleanText(req.body.role, 40).toLowerCase();
    const identifier = normalizeIdentifier(req.body.identifier);
    const password = String(req.body.password === undefined || req.body.password === null ? "" : req.body.password);

    if (!ACCOUNT_ROLES.includes(role) || !identifier || !password) {
      return res.status(400).json({ error: "role, identifier और password आवश्यक हैं / role, identifier and password are required" });
    }

    const account = await Account.findOne({ identifier, role });
    if (!account || !verifyPassword(password, account.passwordHash)) {
      return res.status(401).json({ error: BAD_CREDENTIALS });
    }
    if (account.status !== "active") {
      return res.status(403).json({ error: "यह खाता निलंबित है / This account is suspended" });
    }

    account.lastLoginAt = new Date();
    await account.save();

    res.json({
      token: signToken({ role: account.role, identifier: account.identifier, accountId: account.id }),
      account: account.toJSON(),
    });
  })
);

// GET /api/accounts/me -- lets a page confirm the stored token is still valid
// and pick up profile changes without signing in again.
router.get(
  "/me",
  requireAccount(),
  asyncHandler(async (req, res) => {
    res.json(req.account.toJSON());
  })
);

// PATCH /api/accounts/me   body: { name?, designation?, organisation?, district?, phone? }
router.patch(
  "/me",
  requireAccount(),
  asyncHandler(async (req, res) => {
    const editable = ["name", "designation", "organisation", "district", "phone"];
    editable.forEach((field) => {
      if (req.body[field] !== undefined) req.account[field] = cleanText(req.body[field]) || undefined;
    });
    await req.account.save();
    res.json(req.account.toJSON());
  })
);

// GET /api/accounts?role=startup -- officer-facing directory used by the
// government portals (Industry-CSR page) to list partner enterprises.
router.get(
  "/",
  requireAccount("government", "admin"),
  asyncHandler(async (req, res) => {
    const filter = {};
    const role = cleanText(req.query.role, 40).toLowerCase();
    if (role) filter.role = role;
    const accounts = await Account.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json(accounts.map((account) => account.toJSON()));
  })
);

module.exports = router;
