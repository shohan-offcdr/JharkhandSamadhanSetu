const express = require("express");
const Problem = require("../models/Problem");
const Solution = require("../models/Solution");
const { SOLUTION_STATUS } = require("../models/Solution");
const { generateSolutionId } = require("../utils/categorize");
const requireAccount = require("../middleware/requireAccount");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

const MAX_TEXT = 5000;

function cleanText(value, maxLength) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, maxLength);
}

function cleanNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

// POST /api/solutions — a student submits a solution to a student-visible grievance.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const problemId = cleanText(req.body.problemId, 40).toUpperCase();
    const title = cleanText(req.body.title, 300);
    const summary = cleanText(req.body.summary, MAX_TEXT);
    if (!problemId || !title || !summary) {
      return res.status(400).json({ error: "problemId, title और summary आवश्यक हैं / problemId, title and summary are required" });
    }
    const problem = await Problem.findOne({ id: problemId });
    if (!problem) return res.status(404).json({ error: "शिकायत नहीं मिली / Grievance not found" });
    if (problem.visibleToStudents === false || problem.status === "Rejected") {
      return res.status(403).json({ error: "इस समस्या पर समाधान स्वीकार नहीं हो रहे / Solutions are not accepted for this problem" });
    }
    const doc = {
      problemId,
      studentId: cleanText(req.body.studentId, 160) || undefined,
      title,
      summary,
      approach: cleanText(req.body.approach, MAX_TEXT) || undefined,
      techStack: cleanText(req.body.techStack, 500) || undefined,
      timelineDays: cleanNumber(req.body.timelineDays),
      team: cleanText(req.body.team, 500) || undefined,
      status: "Submitted",
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const created = await Solution.create({ ...doc, id: generateSolutionId() });
        return res.status(201).json(created);
      } catch (err) {
        if (err.code === 11000 && attempt < 2) continue;
        throw err;
      }
    }
    return res.status(500).json({ error: "समाधान सहेजा नहीं जा सका / Could not save the solution" });
  })
);

// GET /api/solutions?problemId=JH-2026-XXXXX&studentId=&status= — solutions for
// one problem / one partner, newest first.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.problemId) filter.problemId = cleanText(req.query.problemId, 40).toUpperCase();
    if (req.query.studentId) filter.studentId = cleanText(req.query.studentId, 160);
    if (req.query.status) filter.status = cleanText(req.query.status, 40);
    const solutions = await Solution.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json(solutions);
  })
);

// PATCH /api/solutions/:id/status   body: { status }
// The government review step: Submitted -> Under Review -> Shortlisted | Rejected.
router.patch(
  "/:id/status",
  requireAccount("government", "admin"),
  asyncHandler(async (req, res) => {
    if (!SOLUTION_STATUS.includes(req.body.status)) {
      return res.status(400).json({ error: `status must be one of: ${SOLUTION_STATUS.join(", ")}` });
    }
    const solution = await Solution.findOneAndUpdate(
      { id: String(req.params.id || "").toUpperCase() },
      { status: req.body.status },
      { new: true }
    );
    if (!solution) return res.status(404).json({ error: "समाधान नहीं मिला / Solution not found" });
    res.json(solution);
  })
);

// GET /api/solutions/:id — one solution by SL-* id.
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const solution = await Solution.findOne({ id: String(req.params.id || "").toUpperCase() });
    if (!solution) return res.status(404).json({ error: "समाधान नहीं मिला / Solution not found" });
    res.json(solution);
  })
);

module.exports = router;
