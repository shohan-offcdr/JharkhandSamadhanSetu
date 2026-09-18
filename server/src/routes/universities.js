const express = require("express");
const University = require("../models/University");
const { UNIVERSITY_STATUS } = require("../models/University");
const { generateUniversityId } = require("../utils/categorize");
const requireAccount = require("../middleware/requireAccount");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

function cleanText(value, maxLength = 300) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, maxLength);
}

function cleanStringList(value, maxItems = 20, maxLength = 80) {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function cleanNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(max, Math.max(min, number));
}

// GET /api/universities?district=&status=&q=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.district) filter.district = cleanText(req.query.district, 80);
    if (req.query.status && UNIVERSITY_STATUS.includes(req.query.status)) filter.status = req.query.status;
    if (req.query.q) {
      const safe = cleanText(req.query.q, 120).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [{ name: new RegExp(safe, "i") }, { shortName: new RegExp(safe, "i") }, { specializations: new RegExp(safe, "i") }];
    }
    const universities = await University.find(filter).sort({ performanceScore: -1, name: 1 }).limit(300);
    res.json(universities);
  })
);

// GET /api/universities/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const university = await University.findOne({ id: cleanText(req.params.id, 60).toUpperCase() });
    if (!university) return res.status(404).json({ error: "संस्थान नहीं मिला / University not found" });
    res.json(university);
  })
);

// POST /api/universities — officers add a partner institution.
router.post(
  "/",
  requireAccount("government", "admin"),
  asyncHandler(async (req, res) => {
    const name = cleanText(req.body.name);
    const district = cleanText(req.body.district, 80);
    if (!name || !district) {
      return res.status(400).json({ error: "name और district आवश्यक हैं / name and district are required" });
    }

    const doc = {
      name,
      district,
      shortName: cleanText(req.body.shortName, 60) || undefined,
      specializations: cleanStringList(req.body.specializations) || [],
      coordinatorName: cleanText(req.body.coordinatorName, 160) || undefined,
      coordinatorEmail: cleanText(req.body.coordinatorEmail, 160).toLowerCase() || undefined,
      coordinatorPhone: cleanText(req.body.coordinatorPhone, 40) || undefined,
      status: UNIVERSITY_STATUS.includes(req.body.status) ? req.body.status : "Pending Verification",
      notes: cleanText(req.body.notes, 1000) || undefined,
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const created = await University.create({ ...doc, id: generateUniversityId() });
        return res.status(201).json(created);
      } catch (err) {
        if (err.code === 11000 && attempt < 2) continue; // random id collision
        throw err;
      }
    }
    return res.status(500).json({ error: "संस्थान सहेजा नहीं जा सका / Could not save the university" });
  })
);

// PATCH /api/universities/:id — verify, suspend, or refresh the counters.
router.patch(
  "/:id",
  requireAccount("government", "admin"),
  asyncHandler(async (req, res) => {
    const university = await University.findOne({ id: cleanText(req.params.id, 60).toUpperCase() });
    if (!university) return res.status(404).json({ error: "संस्थान नहीं मिला / University not found" });

    if (req.body.status !== undefined) {
      if (!UNIVERSITY_STATUS.includes(req.body.status)) {
        return res.status(400).json({ error: `status must be one of: ${UNIVERSITY_STATUS.join(", ")}` });
      }
      university.status = req.body.status;
    }
    ["name", "shortName", "district", "coordinatorName", "coordinatorEmail", "coordinatorPhone", "notes"].forEach((field) => {
      if (req.body[field] !== undefined) university[field] = cleanText(req.body[field]) || undefined;
    });
    if (req.body.specializations !== undefined) university.specializations = cleanStringList(req.body.specializations) || [];
    ["acceptedCount", "activeCount", "completedCount"].forEach((field) => {
      const value = cleanNumber(req.body[field]);
      if (value !== undefined) university[field] = Math.round(value);
    });
    const performance = cleanNumber(req.body.performanceScore, { min: 0, max: 100 });
    if (performance !== undefined) university.performanceScore = Math.round(performance);

    await university.save();
    res.json(university);
  })
);

module.exports = router;
