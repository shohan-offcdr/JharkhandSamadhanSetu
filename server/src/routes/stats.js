const express = require("express");
const Problem = require("../models/Problem");
const { STATUS_VALUES } = require("../models/Problem");
const Solution = require("../models/Solution");
const { SOLUTION_STATUS } = require("../models/Solution");
const University = require("../models/University");
const EnterpriseCsr = require("../models/EnterpriseCsr");
const StartupProfile = require("../models/StartupProfile");
const Collaboration = require("../models/Collaboration");
const requireAccount = require("../middleware/requireAccount");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// Turns [{_id, count}] rows into a fixed-shape object, so the dashboards can
// read `byStatus["Pending Verification"]` without null checks even on an empty
// database (which is exactly when a missing key used to render as "undefined").
function countRowsToMap(rows, keys) {
  const map = {};
  keys.forEach((key) => {
    map[key] = 0;
  });
  rows.forEach((row) => {
    if (row && row._id) map[row._id] = row.count;
  });
  return map;
}

// GET /api/stats/overview — every number the government dashboards display.
router.get(
  "/overview",
  requireAccount("government", "admin"),
  asyncHandler(async (req, res) => {
    const [statusRows, categoryRows, districtRows, problemTotals, latestProblems, solutionRows, countRows] = await Promise.all([
      Problem.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Problem.aggregate([
        { $group: { _id: "$category", count: { $sum: 1 }, avgPriority: { $avg: "$priorityScore" }, reports: { $sum: "$reportCount" } } },
        { $sort: { count: -1 } },
      ]),
      Problem.aggregate([{ $group: { _id: "$district", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 24 }]),
      Problem.aggregate([
        { $group: { _id: null, count: { $sum: 1 }, avgPriority: { $avg: "$priorityScore" }, reports: { $sum: "$reportCount" } } },
      ]),
      Problem.find({})
        .sort({ createdAt: -1, updatedAt: -1 })
        .limit(5)
        .select("id title category district block priorityScore status reportCount createdAt"),
      Solution.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Promise.all([
        University.countDocuments({ status: "Active" }),
        EnterpriseCsr.countDocuments({}),
        EnterpriseCsr.aggregate([{ $group: { _id: null, committed: { $sum: "$committedAmount" } } }]),
        StartupProfile.countDocuments({ verified: true }),
        Collaboration.countDocuments({}),
        Collaboration.aggregate([{ $group: { _id: null, fundingCommitted: { $sum: "$fundingCommitted" } } }]),
      ]),
    ]);

    const totals = problemTotals[0] || { count: 0, avgPriority: 0, reports: 0 };

    res.json({
      totals: {
        problems: totals.count,
        avgPriority: totals.avgPriority ? Math.round(totals.avgPriority) : 0,
        reports: totals.reports || 0,
        solutions: solutionRows.reduce((sum, row) => sum + row.count, 0),
        universities: countRows[0],
        enterprises: countRows[1],
        csrCommitted: (countRows[2][0] && countRows[2][0].committed) || 0,
        verifiedPartners: countRows[3],
        collaborations: countRows[4],
        fundingCommitted: (countRows[5][0] && countRows[5][0].fundingCommitted) || 0,
      },
      byStatus: countRowsToMap(statusRows, STATUS_VALUES),
      bySolutionStatus: countRowsToMap(solutionRows, SOLUTION_STATUS),
      byCategory: categoryRows.map((row) => ({
        category: row._id || "Other",
        count: row.count,
        avgPriority: row.avgPriority ? Math.round(row.avgPriority) : 0,
        reports: row.reports || 0,
      })),
      byDistrict: districtRows.map((row) => ({ district: row._id || "Unspecified", count: row.count })),
      latestProblems: latestProblems,
    });
  })
);

// GET /api/stats/impact?partnerId= — one partner's own delivery numbers.
router.get(
  "/impact",
  requireAccount(),
  asyncHandler(async (req, res) => {
    const isOfficerView = ["government", "admin"].includes(req.account.role);
    const partnerId = isOfficerView && req.query.partnerId ? String(req.query.partnerId).trim().toLowerCase() : req.account.identifier;

    const [collaborations, solutions] = await Promise.all([
      Collaboration.find({ partnerId }).sort({ createdAt: -1 }),
      Solution.find({ studentId: partnerId }).sort({ createdAt: -1 }),
    ]);

    const problemIds = [...new Set(collaborations.map((item) => item.problemId))];
    const problems = problemIds.length ? await Problem.find({ id: { $in: problemIds } }) : [];

    const milestones = collaborations.flatMap((item) => item.milestones || []);
    const completedMilestones = milestones.filter((item) => item.status === "Completed").length;
    const blockedMilestones = milestones.filter((item) => item.status === "Blocked").length;
    const avgProgress = milestones.length
      ? Math.round(milestones.reduce((sum, item) => sum + (item.progress || 0), 0) / milestones.length)
      : 0;

    const districtBreakdown = problems.reduce((map, problem) => {
      const key = problem.district || "Unspecified";
      map[key] = (map[key] || 0) + 1;
      return map;
    }, {});

    res.json({
      partnerId,
      totals: {
        engagements: collaborations.length,
        problemsEngaged: problemIds.length,
        solutionsSubmitted: solutions.length,
        fundingCommitted: collaborations.reduce((sum, item) => sum + (item.fundingCommitted || 0), 0),
        milestones: milestones.length,
        completedMilestones,
        blockedMilestones,
        avgProgress,
        districtsCovered: Object.keys(districtBreakdown).length,
        citizensReached: problems.reduce((sum, problem) => sum + (problem.reportCount || 0), 0),
      },
      byStage: collaborations.reduce((map, item) => {
        map[item.stage] = (map[item.stage] || 0) + 1;
        return map;
      }, {}),
      byDistrict: Object.entries(districtBreakdown).map(([district, count]) => ({ district, count })),
      milestones: milestones.slice(0, 100),
      collaborations,
      solutions,
    });
  })
);

module.exports = router;