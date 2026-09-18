const express = require("express");
const Collaboration = require("../models/Collaboration");
const { COLLAB_TYPES, COLLAB_STAGES, MILESTONE_STATUS } = require("../models/Collaboration");
const Problem = require("../models/Problem");
const { generateCollaborationId } = require("../utils/categorize");
const requireAccount = require("../middleware/requireAccount");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

function cleanText(value, maxLength = 300) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, maxLength);
}

function cleanNumber(value, min = 0) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= min ? number : undefined;
}

// Officers may change any engagement; a partner may only change its own.
function canManage(account, collaboration) {
  if (["government", "admin"].includes(account.role)) return true;
  return collaboration.partnerId === account.identifier;
}

// POST /api/collaborations — a partner engages a grievance.
// body: { problemId, solutionId?, universityId?, universityName?, type?, title?, summary?, fundingCommitted? }
router.post(
  "/",
  requireAccount("startup", "government", "admin"),
  asyncHandler(async (req, res) => {
    const problemId = cleanText(req.body.problemId, 40).toUpperCase();
    if (!problemId) return res.status(400).json({ error: "problemId आवश्यक है / problemId is required" });

    const problem = await Problem.findOne({ id: problemId });
    if (!problem) return res.status(404).json({ error: "शिकायत नहीं मिली / Grievance not found" });
    if (problem.visibleToStudents === false || problem.status === "Rejected") {
      return res.status(403).json({ error: "इस समस्या पर सहयोग स्वीकार नहीं हो रहा / Collaboration is not open for this problem" });
    }

    const type = COLLAB_TYPES.includes(req.body.type) ? req.body.type : "Interest";
    const doc = {
      problemId,
      solutionId: cleanText(req.body.solutionId, 40) || undefined,
      partnerId: req.account.identifier,
      partnerName: cleanText(req.body.partnerName) || req.account.organisation || req.account.name || undefined,
      universityId: cleanText(req.body.universityId, 60) || undefined,
      universityName: cleanText(req.body.universityName) || undefined,
      type,
      stage: "Interest",
      title: cleanText(req.body.title) || problem.title,
      summary: cleanText(req.body.summary, 4000) || undefined,
      fundingCommitted: cleanNumber(req.body.fundingCommitted) || 0,
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const created = await Collaboration.create({ ...doc, id: generateCollaborationId() });
        return res.status(201).json(created);
      } catch (err) {
        if (err.code === 11000 && attempt < 2) continue;
        throw err;
      }
    }
    return res.status(500).json({ error: "सहयोग सहेजा नहीं जा सका / Could not save the collaboration" });
  })
);

// GET /api/collaborations?partnerId=&problemId=&stage=&type=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.partnerId) filter.partnerId = cleanText(req.query.partnerId, 160).toLowerCase();
    if (req.query.problemId) filter.problemId = cleanText(req.query.problemId, 40).toUpperCase();
    if (req.query.stage && COLLAB_STAGES.includes(req.query.stage)) filter.stage = req.query.stage;
    if (req.query.type && COLLAB_TYPES.includes(req.query.type)) filter.type = req.query.type;
    const collaborations = await Collaboration.find(filter).sort({ createdAt: -1 }).limit(300);
    res.json(collaborations);
  })
);

// GET /api/collaborations/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const collaboration = await Collaboration.findOne({ id: cleanText(req.params.id, 60).toUpperCase() });
    if (!collaboration) return res.status(404).json({ error: "सहयोग नहीं मिला / Collaboration not found" });
    res.json(collaboration);
  })
);

// PATCH /api/collaborations/:id/stage   body: { stage, fundingCommitted? }
router.patch(
  "/:id/stage",
  requireAccount(),
  asyncHandler(async (req, res) => {
    const collaboration = await Collaboration.findOne({ id: cleanText(req.params.id, 60).toUpperCase() });
    if (!collaboration) return res.status(404).json({ error: "सहयोग नहीं मिला / Collaboration not found" });
    if (!canManage(req.account, collaboration)) {
      return res.status(403).json({ error: "इस सहयोग को बदलने की अनुमति नहीं है / Not allowed to change this collaboration" });
    }
    if (!COLLAB_STAGES.includes(req.body.stage)) {
      return res.status(400).json({ error: `stage must be one of: ${COLLAB_STAGES.join(", ")}` });
    }

    collaboration.stage = req.body.stage;
    const fundingCommitted = cleanNumber(req.body.fundingCommitted);
    if (fundingCommitted !== undefined) collaboration.fundingCommitted = fundingCommitted;

    await collaboration.save();
    res.json(collaboration);
  })
);

// POST /api/collaborations/:id/milestones   body: { name, dueDate?, status?, progress?, note? }
router.post(
  "/:id/milestones",
  requireAccount(),
  asyncHandler(async (req, res) => {
    const collaboration = await Collaboration.findOne({ id: cleanText(req.params.id, 60).toUpperCase() });
    if (!collaboration) return res.status(404).json({ error: "सहयोग नहीं मिला / Collaboration not found" });
    if (!canManage(req.account, collaboration)) {
      return res.status(403).json({ error: "इस सहयोग को बदलने की अनुमति नहीं है / Not allowed to change this collaboration" });
    }
    const name = cleanText(req.body.name);
    if (!name) return res.status(400).json({ error: "name आवश्यक है / name is required" });

    const progress = cleanNumber(req.body.progress, 0);
    collaboration.milestones.push({
      // Readable and stable per engagement: MS-1, MS-2, ...
      id: `MS-${collaboration.milestones.length + 1}`,
      name,
      dueDate: cleanText(req.body.dueDate, 40) || undefined,
      status: MILESTONE_STATUS.includes(req.body.status) ? req.body.status : "Pending",
      progress: progress === undefined ? 0 : Math.min(100, Math.round(progress)),
      note: cleanText(req.body.note, 1000) || undefined,
    });

    await collaboration.save();
    res.status(201).json(collaboration);
  })
);

// PATCH /api/collaborations/:id/milestones/:milestoneId
// body: { status?, progress?, note?, dueDate?, name? }
router.patch(
  "/:id/milestones/:milestoneId",
  requireAccount(),
  asyncHandler(async (req, res) => {
    const collaboration = await Collaboration.findOne({ id: cleanText(req.params.id, 60).toUpperCase() });
    if (!collaboration) return res.status(404).json({ error: "सहयोग नहीं मिला / Collaboration not found" });
    if (!canManage(req.account, collaboration)) {
      return res.status(403).json({ error: "इस सहयोग को बदलने की अनुमति नहीं है / Not allowed to change this collaboration" });
    }
    const milestone = collaboration.milestones.find((item) => item.id === cleanText(req.params.milestoneId, 40));
    if (!milestone) return res.status(404).json({ error: "माइलस्टोन नहीं मिला / Milestone not found" });

    if (req.body.status !== undefined) {
      if (!MILESTONE_STATUS.includes(req.body.status)) {
        return res.status(400).json({ error: `status must be one of: ${MILESTONE_STATUS.join(", ")}` });
      }
      milestone.status = req.body.status;
      // Keep the bar honest: a completed milestone reads 100 even when the caller
      // sent only the status.
      if (req.body.progress === undefined && req.body.status === "Completed") milestone.progress = 100;
    }
    const progress = cleanNumber(req.body.progress, 0);
    if (progress !== undefined) milestone.progress = Math.min(100, Math.round(progress));
    if (req.body.note !== undefined) milestone.note = cleanText(req.body.note, 1000) || undefined;
    if (req.body.dueDate !== undefined) milestone.dueDate = cleanText(req.body.dueDate, 40) || undefined;
    if (req.body.name !== undefined) milestone.name = cleanText(req.body.name) || milestone.name;

    await collaboration.save();
    res.json(collaboration);
  })
);

// POST /api/collaborations/:id/messages   body: { body }
router.post(
  "/:id/messages",
  requireAccount(),
  asyncHandler(async (req, res) => {
    const collaboration = await Collaboration.findOne({ id: cleanText(req.params.id, 60).toUpperCase() });
    if (!collaboration) return res.status(404).json({ error: "सहयोग नहीं मिला / Collaboration not found" });
    if (!canManage(req.account, collaboration)) {
      return res.status(403).json({ error: "इस सहयोग पर संदेश भेजने की अनुमति नहीं है / Not allowed to post on this collaboration" });
    }
    const body = cleanText(req.body.body, 2000);
    if (!body) return res.status(400).json({ error: "संदेश खाली नहीं हो सकता / Message cannot be empty" });

    // Author and role come from the verified token, never from the request body.
    collaboration.messages.push({
      author: req.account.name || req.account.identifier,
      role: req.account.role,
      body,
      at: new Date(),
    });

    await collaboration.save();
    res.status(201).json(collaboration);
  })
);

module.exports = router;