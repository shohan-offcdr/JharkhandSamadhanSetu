const express = require("express");
const StartupProfile = require("../models/StartupProfile");
const requireAccount = require("../middleware/requireAccount");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

function cleanText(value, maxLength = 300) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, maxLength);
}

function cleanStringList(value, maxItems = 30, maxLength = 120) {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function cleanNumber(value, min = 0) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= min ? number : undefined;
}

function cleanPastProjects(value) {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((project) => ({
      title: cleanText(project && project.title, 300),
      district: cleanText(project && project.district, 80),
      year: cleanNumber(project && project.year),
      outcome: cleanText(project && project.outcome, 500),
    }))
    .filter((project) => project.title)
    .slice(0, 30);
}

// GET /api/startups?verified=true&q= — partner directory (used by the
// government Industry-CSR page and by project-details to show who is engaged).
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.verified === "true") filter.verified = true;
    if (req.query.q) {
      const safe = cleanText(req.query.q, 120).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [{ companyName: new RegExp(safe, "i") }, { sectors: new RegExp(safe, "i") }, { districts: new RegExp(safe, "i") }];
    }
    const profiles = await StartupProfile.find(filter).sort({ createdAt: -1 }).limit(300);
    res.json(profiles);
  })
);

// GET /api/startups/:identifier — one partner's own profile (keyed by the
// account e-mail, the same value the startup portal stores in its session).
router.get(
  "/:identifier",
  asyncHandler(async (req, res) => {
    const profile = await StartupProfile.findOne({ identifier: cleanText(req.params.identifier, 160).toLowerCase() });
    if (!profile) return res.status(404).json({ error: "प्रोफ़ाइल नहीं मिली / Profile not found" });
    res.json(profile);
  })
);

// PUT /api/startups/:identifier — create/update your own organisation profile.
// A partner may only write its own identifier; an admin may write any.
router.put(
  "/:identifier",
  requireAccount("startup", "admin"),
  asyncHandler(async (req, res) => {
    const identifier = cleanText(req.params.identifier, 160).toLowerCase();
    if (req.account.role !== "admin" && identifier !== req.account.identifier) {
      return res.status(403).json({ error: "केवल अपनी ही प्रोफ़ाल बदली जा सकती है / You can only edit your own profile" });
    }

    const companyName = cleanText(req.body.companyName);
    const existing = await StartupProfile.findOne({ identifier });
    if (!companyName && !existing) {
      return res.status(400).json({ error: "companyName आवश्यक है / companyName is required" });
    }

    const profile =
      existing ||
      new StartupProfile({
        identifier,
        companyName,
      });

    if (companyName) profile.companyName = companyName;
    ["organisation", "dlpiNumber", "about", "capacityPerYear", "website", "contactEmail", "contactPhone"].forEach((field) => {
      if (req.body[field] !== undefined) profile[field] = cleanText(req.body[field], field === "about" ? 2000 : 300) || undefined;
    });
    ["sectors", "capabilities", "labEquipment", "districts"].forEach((field) => {
      const list = cleanStringList(req.body[field]);
      if (list) profile[field] = list;
    });
    const teamSize = cleanNumber(req.body.teamSize);
    if (teamSize !== undefined) profile.teamSize = Math.round(teamSize);
    ["investmentMin", "investmentMax"].forEach((field) => {
      const value = cleanNumber(req.body[field]);
      if (value !== undefined) profile[field] = Math.round(value);
    });
    const pastProjects = cleanPastProjects(req.body.pastProjects);
    if (pastProjects) profile.pastProjects = pastProjects;

    await profile.save();
    res.json(profile);
  })
);

// PATCH /api/startups/:id/verify — officer marks a partner as verified.
router.patch(
  "/:id/verify",
  requireAccount("government", "admin"),
  asyncHandler(async (req, res) => {
    const identifier = cleanText(req.params.id, 160).toLowerCase();
    const profile = await StartupProfile.findOne({ identifier });
    if (!profile) return res.status(404).json({ error: "प्रोफ़ाइल नहीं मिली / Profile not found" });
    profile.verified = req.body.verified === undefined ? true : Boolean(req.body.verified);
    await profile.save();
    res.json(profile);
  })
);

module.exports = router;