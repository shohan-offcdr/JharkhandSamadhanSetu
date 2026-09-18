const express = require("express");
const Match = require("../models/Match");
const { getMatchesForStartup } = require("../services/matchEngine");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// GET /api/matches?startupId=xxx — sorted by matchScore desc
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { startupId } = req.query;
    if (!startupId) {
      return res.status(400).json({ error: "startupId is required / startupId आवश्यक है" });
    }

    const matches = await getMatchesForStartup(String(startupId));
    res.json(matches);
  })
);

module.exports = router;
