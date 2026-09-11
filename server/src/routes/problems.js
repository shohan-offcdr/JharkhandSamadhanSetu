const express = require("express");
const Problem = require("../models/Problem");
const { analyzeProblem, similarityScore, generateProblemId } = require("../utils/categorize");

const router = express.Router();

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET /api/problems?district=Ranchi&category=...&status=...&sortBy=priority
router.get("/", async (req, res) => {
  try {
    const { district, category, status, sortBy } = req.query;
    const filter = {};
    if (district) filter.district = district;
    if (category) filter.category = category;
    if (status) filter.status = status;

    const sort = sortBy === "priority" ? { priorityScore: -1 } : { createdAt: -1 };
    const problems = await Problem.find(filter).sort(sort);
    res.json(problems);
  } catch (err) {
    console.error("[problems] list failed:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/problems/:id  (human-facing ID, e.g. JH-2024-10312 -- used by the homepage tracker)
router.get("/:id", async (req, res) => {
  try {
    const problem = await Problem.findOne({ id: req.params.id.toUpperCase() });
    if (!problem) {
      return res.status(404).json({ error: `"${req.params.id}" क्रमांक से कोई शिकायत नहीं मिली / No grievance found for that ID` });
    }
    res.json(problem);
  } catch (err) {
    console.error("[problems] get failed:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/problems  -- same auto-fill behaviour as api.js's submitProblem()
router.post("/", async (req, res) => {
  const { title, description, district, block, gramPanchayat, pincode, landmark, gpsLat, gpsLng, evidenceFileName, scaleOfImpact, durationDays, photos, titleHi } = req.body;

  if (!title || !description || !district) {
    return res.status(400).json({ error: "title, description और district आवश्यक हैं / title, description and district are required" });
  }

  const analysis = analyzeProblem({ title, description, district, scaleOfImpact, durationDays });
  const base = {
    title,
    titleHi,
    description,
    district,
    block,
    gramPanchayat,
    pincode,
    landmark,
    gpsLat,
    gpsLng,
    evidenceFileName,
    scaleOfImpact,
    durationDays,
    photos,
    category: analysis.category,
    status: "Pending Verification",
    reportCount: 1,
    createdAt: new Date().toISOString().slice(0, 10),
  };
  base.priorityScore = analysis.priorityScore;
  base.analysisVersion = analysis.analysisVersion;

  const candidates = await Problem.find({ district: new RegExp(`^${escapeRegExp(analysis.district)}$`, "i"), category: base.category }).limit(100);
  const duplicate = candidates
    .map((candidate) => ({ candidate, score: similarityScore(analysis.tokens, new Set(`${candidate.title} ${candidate.description}`.toLowerCase().match(/[a-z0-9\u0900-\u097f]{3,}/g) || [])) }))
    .sort((a, b) => b.score - a.score)[0];

  if (duplicate && duplicate.score >= 0.45) {
    const priorityScore = Math.min(100, Math.max(base.priorityScore, Number(duplicate.candidate.priorityScore || 0) + 5));
    const updated = await Problem.findOneAndUpdate(
      { _id: duplicate.candidate._id },
      { $inc: { reportCount: 1 }, $set: { duplicateOf: duplicate.candidate.id, priorityScore } },
      { new: true }
    );
    return res.status(200).json({ ...updated.toJSON(), duplicate: true, similarity: Number(duplicate.score.toFixed(2)) });
  }

  // Human-facing IDs are randomly generated, like the frontend mock -- retry a
  // couple of times on the rare collision instead of trusting randomness once.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const problem = await Problem.create({ ...base, id: generateProblemId() });
      return res.status(201).json(problem);
    } catch (err) {
      if (err.code === 11000 && attempt < 2) continue; // duplicate id, retry
      console.error("[problems] create failed:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  }
});

// PATCH /api/problems/:id/status   body: { status }
router.patch("/:id/status", async (req, res) => {
  const { status } = req.body;
  const { STATUS_VALUES } = require("../models/Problem");
  if (!STATUS_VALUES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUS_VALUES.join(", ")}` });
  }
  try {
    const problem = await Problem.findOneAndUpdate({ id: req.params.id.toUpperCase() }, { status }, { new: true });
    if (!problem) return res.status(404).json({ error: "Grievance not found" });
    res.json(problem);
  } catch (err) {
    console.error("[problems] status update failed:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// PATCH /api/problems/:id/bump  -- "me too, I have this issue too" button
router.patch("/:id/bump", async (req, res) => {
  try {
    const problem = await Problem.findOneAndUpdate(
      { id: req.params.id.toUpperCase() },
      { $inc: { reportCount: 1 } },
      { new: true }
    );
    if (!problem) return res.status(404).json({ error: "Grievance not found" });
    res.json(problem);
  } catch (err) {
    console.error("[problems] bump failed:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
