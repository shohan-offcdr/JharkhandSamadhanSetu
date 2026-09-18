const express = require("express");
const Problem = require("../models/Problem");
const { STATUS_VALUES, priorityTierFor } = require("../models/Problem");
const { similarityScore, generateProblemId, prioritize } = require("../utils/categorize");
const { analyzeGrievance } = require("../services/aiAnalyzer");
const { enqueueProblemAnalysis } = require("../services/analysisQueue");
const { mergeAiFactors, aiFactorsFromLocalRules } = require("../services/aiFactors");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

const SCALE_VALUES = ["Individual Household", "Specific Neighbourhood", "Village", "Multiple Villages", "Entire District"];
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_PHOTOS = 5;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Trims and caps free text. Without the cap a single request could store
// megabytes of "description" in the database.
function cleanText(value, maxLength) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, maxLength);
}

// Coerces numbers, and turns anything unparseable ("", "12 weeks") into
// undefined instead of letting Mongoose raise a CastError -- which used to
// surface as an HTTP 500 on an otherwise valid-looking submission.
function cleanNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

// GET /api/problems?district=&category=&status=&sortBy=priority&q=&audience=student
// audience=student returns only visibleToStudents problems with a
// student-safe projection (full docs otherwise, for citizen/govt callers).
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { district, category, status, sortBy, q, audience } = req.query;
    const filter = {};
    if (district) filter.district = district;
    if (category) filter.category = category;
    if (status) filter.status = status;
    if (audience === "student") {
      filter.visibleToStudents = { $ne: false };
      filter.status = filter.status || { $ne: "Rejected" };
    }
    if (q) {
      const safe = escapeRegExp(String(q).slice(0, 120));
      filter.$or = [
        { title: new RegExp(safe, "i") },
        { problemStatement: new RegExp(safe, "i") },
        { enrichedDescription: new RegExp(safe, "i") },
        { description: new RegExp(safe, "i") },
      ];
    }

    const sort = sortBy === "priority" ? { finalPriorityScore: -1 } : { createdAt: -1 };
    const query = Problem.find(filter).sort(sort).limit(500);
    if (audience === "student") {
      query.select(
        "id title titleHi problemStatement enrichedDescription description category categoryConfidence district block priorityScore priorityLabel priorityTier finalPriorityScore priorityReasons reportCount similarity duplicateOf status photos createdAt analysisVersion"
      );
    }
    const problems = await query;
    res.json(problems);
  })
);

// GET /api/problems/:id  (human-facing ID, e.g. JH-2024-10312 -- used by the homepage tracker)
// ?audience=student hides non-visible/rejected with the same 404 as unknown IDs.
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const problem = await Problem.findOne({ id: String(req.params.id || "").toUpperCase() });
    if (!problem) {
      return res.status(404).json({ error: `"${req.params.id}" क्रमांक से कोई शिकायत नहीं मिली / No grievance found for that ID` });
    }
    if (req.query.audience === "student" && (problem.visibleToStudents === false || problem.status === "Rejected")) {
      return res.status(404).json({ error: `"${req.params.id}" क्रमांक से कोई शिकायत नहीं मिली / No grievance found for that ID` });
    }
    res.json(problem);
  })
);

// POST /api/problems  -- same auto-fill behaviour as api.js's submitProblem()
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const title = cleanText(req.body.title, 300);
    const description = cleanText(req.body.description, MAX_DESCRIPTION_LENGTH);
    const district = cleanText(req.body.district, 120);

    if (!title || !description || !district) {
      return res.status(400).json({ error: "title, description और district आवश्यक हैं / title, description and district are required" });
    }

    // Everything below is normalised before it reaches Mongoose. The old handler
    // passed req.body straight through, so a form field like durationDays=""
    // or an unexpected scaleOfImpact made Mongoose throw a CastError/enum error
    // and the API answered 500 -- from the citizen's side, a failed submission
    // with no explanation.
    const scaleOfImpact = SCALE_VALUES.includes(req.body.scaleOfImpact) ? req.body.scaleOfImpact : undefined;
    const durationDays = cleanNumber(req.body.durationDays) || 0;
    const photos = Array.isArray(req.body.photos)
      ? req.body.photos.slice(0, MAX_PHOTOS).map((photo) => ({
          url: cleanText(photo && photo.url, 500),
          publicId: cleanText(photo && photo.publicId, 300),
          width: cleanNumber(photo && photo.width),
          height: cleanNumber(photo && photo.height),
          bytes: cleanNumber(photo && photo.bytes),
        }))
      : [];

    const block = cleanText(req.body.block, 120) || undefined;
    // Grok enrichment never blocks the submission: analyzeGrievance() falls
    // back to local rules when AI_API_KEY is missing or Grok fails.
    // Priority weighs scale + duration + report volume + category risk +
    // photo evidence; analyzeGrievance() returns the score, label and reasons.
    const analysis = await analyzeGrievance({
      title,
      description,
      district,
      block,
      scaleOfImpact,
      durationDays,
      reportCount: 1,
      photoCount: photos.length,
    });
    const base = {
      title,
      titleHi: cleanText(req.body.titleHi, 300) || undefined,
      description,
      district,
      block,
      gramPanchayat: cleanText(req.body.gramPanchayat, 120) || undefined,
      pincode: cleanText(req.body.pincode, 12) || undefined,
      landmark: cleanText(req.body.landmark, 200) || undefined,
      gpsLat: cleanNumber(req.body.gpsLat),
      gpsLng: cleanNumber(req.body.gpsLng),
      evidenceFileName: cleanText(req.body.evidenceFileName, 255) || undefined,
      scaleOfImpact,
      durationDays,
      photos,
      category: analysis.category,
      categoryConfidence: analysis.categoryConfidence,
      problemStatement: analysis.problemStatement,
      enrichedDescription: analysis.enrichedDescription,
      priorityLabel: analysis.priorityLabel,
      priorityReasons: analysis.priorityReasons,
      aiMeta: analysis.aiMeta,
      // Feature 1: respond immediately with 'pending' — the AI factor extraction
      // runs as a background job (analysisQueue.js) so the citizen is not left
      // waiting on a phone connection for a Grok round-trip.
      analysisStatus: "pending",
      aiProviderUsed: "pending",
      visibleToStudents: true,
      status: "Pending Verification",
      reportCount: 1,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    base.priorityScore = analysis.priorityScore;
    base.finalPriorityScore = analysis.priorityScore; // mirrors until AI factors arrive
    base.analysisVersion = analysis.analysisVersion;
    base.priorityTier = analysis.priorityLabel ? priorityTierFor(analysis.priorityScore) : "low";

    const candidates = await Problem.find({ district: new RegExp(`^${escapeRegExp(analysis.district)}$`, "i"), category: base.category }).limit(100);
    const duplicate = candidates
      .map((candidate) => ({
        candidate,
        score: similarityScore(analysis.tokens, new Set(`${candidate.title} ${candidate.description} ${candidate.problemStatement || ""}`.toLowerCase().match(/[a-z0-9\u0900-\u097f]{3,}/g) || [])),
      }))
      .sort((a, b) => b.score - a.score)[0];

    if (duplicate && duplicate.score >= 0.45) {
      // Feature 1 de-dup guard: when this submission is a near-duplicate of an
      // existing problem, skip a fresh AI call and inherit/average the existing
      // problem's aiFactors instead — saves API cost on repeat reports of the same
      // issue (which is a *signal*, not noise: the duplicate volume itself feeds
      // the "reports" term in the priority formula).
      const baseFactors = duplicate.candidate.aiFactors || {};
      const localFactors = duplicate.candidate.aiFactors
        ? aiFactorsFromLocalRules({
            title: base.title,
            description: base.description,
            scaleOfImpact: base.scaleOfImpact,
            durationDays: base.durationDays,
            reportCount: 1,
            photoCount: base.photos.length,
            category: base.category,
          })
        : {};
      const mergedFactors = mergeAiFactors(baseFactors, localFactors, duplicate.candidate.reportCount, 1);
      // Feature 1 de-dup guard: when this submission is a near-duplicate of an
      // existing problem, skip a fresh AI call and inherit/average the existing
      // problem's aiFactors instead — saves API cost on repeat reports of the same
      // issue (which is a *signal*, not noise: the duplicate volume itself feeds
      // the "reports" term in the priority formula).
      const effectiveReportCount = duplicate.candidate.reportCount + 1;
      const scoring = prioritize({
        scaleOfImpact: base.scaleOfImpact,
        durationDays: base.durationDays,
        reportCount: effectiveReportCount,
        photoCount: base.photos.length,
        category: base.category,
        aiFactors: mergedFactors,
      });
      const priorityScore = Math.min(100, scoring.score);
      const updated = await Problem.findOneAndUpdate(
        { _id: duplicate.candidate._id },
        {
          $inc: { reportCount: 1 },
          $addToSet: { mergedIds: base.title },
          $set: {
            duplicateOf: duplicate.candidate.id,
            similarity: Number(duplicate.score.toFixed(2)),
            priorityScore,
            finalPriorityScore: priorityScore,
            priorityTier: priorityTierFor(priorityScore),
            aiFactors: mergedFactors,
            aiProviderUsed: mergedFactors.source === "llm" ? duplicate.candidate.aiProviderUsed : "local_rules",
            analysisStatus: duplicate.candidate.analysisStatus === "pending" ? "failed_fallback" : duplicate.candidate.analysisStatus,
          },
        },
        { new: true }
      );
      return res.status(200).json({ ...updated.toJSON(), duplicate: true, similarity: Number(duplicate.score.toFixed(2)) });
    }

    // Human-facing IDs are randomly generated, like the frontend mock -- retry a
    // couple of times on the rare collision instead of trusting randomness once.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const problem = await Problem.create({ ...base, id: generateProblemId() });
        // Feature 1: kick off the AI factor extraction as a background job so the
        // 201 response goes out immediately. At current volume a simple in-process
        // queue (analysisQueue.js) is fine; replace with BullMQ if volume grows.
        enqueueProblemAnalysis(problem.id);
        return res.status(201).json(problem);
      } catch (err) {
        if (err.code === 11000 && attempt < 2) continue; // duplicate id, retry
        throw err; // anything else: let the JSON error handler report it
      }
    }

    return res.status(500).json({ error: "विवरण सहेजा नहीं जा सका, कृपया पुनः प्रयास करें / Could not save the grievance, please try again" });
  })
);

// POST /api/problems/:id/reanalyze — re-run Grok enrichment on one grievance.
router.post(
  "/:id/reanalyze",
  asyncHandler(async (req, res) => {
    const problem = await Problem.findOne({ id: String(req.params.id || "").toUpperCase() });
    if (!problem) return res.status(404).json({ error: "Grievance not found" });
    const analysis = await analyzeGrievance({
      title: problem.title,
      description: problem.description,
      district: problem.district,
      block: problem.block,
      scaleOfImpact: problem.scaleOfImpact,
      durationDays: problem.durationDays,
      reportCount: problem.reportCount,
      photoCount: Array.isArray(problem.photos) ? problem.photos.length : 0,
    });
    problem.category = analysis.category;
    problem.categoryConfidence = analysis.categoryConfidence;
    problem.problemStatement = analysis.problemStatement;
    problem.enrichedDescription = analysis.enrichedDescription;
    problem.priorityScore = analysis.priorityScore;
    problem.priorityLabel = analysis.priorityLabel;
    problem.priorityReasons = analysis.priorityReasons;
    problem.analysisVersion = analysis.analysisVersion;
    problem.analysisStatus = analysis.analysisStatus || "ok";
    problem.aiProviderUsed = analysis.aiProviderUsed || "local_rules";
    if (analysis.aiMeta) problem.aiMeta = analysis.aiMeta;
    await problem.save();
    res.json(problem);
  })
);

// PATCH /api/problems/:id/status   body: { status }
router.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!STATUS_VALUES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${STATUS_VALUES.join(", ")}` });
    }
    const problem = await Problem.findOneAndUpdate({ id: String(req.params.id || "").toUpperCase() }, { status }, { new: true });
    if (!problem) return res.status(404).json({ error: "Grievance not found" });
    res.json(problem);
  })
);

// PATCH /api/problems/:id/bump  -- "me too, I have this issue too" button
router.patch(
  "/:id/bump",
  asyncHandler(async (req, res) => {
    const problem = await Problem.findOneAndUpdate(
      { id: String(req.params.id || "").toUpperCase() },
      { $inc: { reportCount: 1 } },
      { new: true }
    );
    if (!problem) return res.status(404).json({ error: "Grievance not found" });
    res.json(problem);
  })
);

module.exports = router;
