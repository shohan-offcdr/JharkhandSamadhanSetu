const express = require("express");
const EnterpriseCsr = require("../models/EnterpriseCsr");
const { CSR_COMPLIANCE_STATUS } = require("../models/EnterpriseCsr");
const { generateEnterpriseId } = require("../utils/categorize");
const requireAccount = require("../middleware/requireAccount");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

function cleanText(value, maxLength = 300) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, maxLength);
}

function cleanTestbeds(value) {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => ({
      name: cleanText(item && item.name, 200),
      location: cleanText(item && item.location, 200),
    }))
    .filter((testbed) => testbed.name || testbed.location)
    .slice(0, 20);
}

function cleanAmount(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : undefined;
}

// GET /api/enterprises?sector=&complianceStatus=&q=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.sector) filter.sector = cleanText(req.query.sector, 160);
    if (req.query.complianceStatus && CSR_COMPLIANCE_STATUS.includes(req.query.complianceStatus)) {
      filter.complianceStatus = req.query.complianceStatus;
    }
    if (req.query.q) {
      const safe = cleanText(req.query.q, 120).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [{ enterpriseName: new RegExp(safe, "i") }, { sector: new RegExp(safe, "i") }, { district: new RegExp(safe, "i") }];
    }
    const enterprises = await EnterpriseCsr.find(filter).sort({ committedAmount: -1, enterpriseName: 1 }).limit(300);
    res.json(enterprises);
  })
);

// GET /api/enterprises/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const enterprise = await EnterpriseCsr.findOne({ id: cleanText(req.params.id, 60).toUpperCase() });
    if (!enterprise) return res.status(404).json({ error: "उद्यम नहीं मिला / Enterprise not found" });
    res.json(enterprise);
  })
);

// POST /api/enterprises — officers register a CSR partner.
router.post(
  "/",
  requireAccount("government", "admin"),
  asyncHandler(async (req, res) => {
    const enterpriseName = cleanText(req.body.enterpriseName);
    if (!enterpriseName) {
      return res.status(400).json({ error: "enterpriseName आवश्यक है / enterpriseName is required" });
    }

    const doc = {
      enterpriseName,
      sector: cleanText(req.body.sector, 160) || undefined,
      committedAmount: cleanAmount(req.body.committedAmount) || 0,
      activeProjects: cleanAmount(req.body.activeProjects) || 0,
      complianceStatus: CSR_COMPLIANCE_STATUS.includes(req.body.complianceStatus) ? req.body.complianceStatus : "Compliance Pending",
      testbeds: cleanTestbeds(req.body.testbeds) || [],
      contactEmail: cleanText(req.body.contactEmail, 160).toLowerCase() || undefined,
      contactName: cleanText(req.body.contactName, 160) || undefined,
      district: cleanText(req.body.district, 80) || undefined,
      notes: cleanText(req.body.notes, 1000) || undefined,
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const created = await EnterpriseCsr.create({ ...doc, id: generateEnterpriseId() });
        return res.status(201).json(created);
      } catch (err) {
        if (err.code === 11000 && attempt < 2) continue;
        throw err;
      }
    }
    return res.status(500).json({ error: "उद्यम सहेजा नहीं जा सका / Could not save the enterprise" });
  })
);

// PATCH /api/enterprises/:id — compliance status, committed amount, testbeds.
router.patch(
  "/:id",
  requireAccount("government", "admin"),
  asyncHandler(async (req, res) => {
    const enterprise = await EnterpriseCsr.findOne({ id: cleanText(req.params.id, 60).toUpperCase() });
    if (!enterprise) return res.status(404).json({ error: "उद्यम नहीं मिला / Enterprise not found" });

    if (req.body.complianceStatus !== undefined) {
      if (!CSR_COMPLIANCE_STATUS.includes(req.body.complianceStatus)) {
        return res.status(400).json({ error: `complianceStatus must be one of: ${CSR_COMPLIANCE_STATUS.join(", ")}` });
      }
      enterprise.complianceStatus = req.body.complianceStatus;
    }
    ["enterpriseName", "sector", "contactEmail", "contactName", "district", "notes"].forEach((field) => {
      if (req.body[field] !== undefined) enterprise[field] = cleanText(req.body[field]) || undefined;
    });
    const committed = cleanAmount(req.body.committedAmount);
    if (committed !== undefined) enterprise.committedAmount = committed;
    const activeProjects = cleanAmount(req.body.activeProjects);
    if (activeProjects !== undefined) enterprise.activeProjects = activeProjects;
    const testbeds = cleanTestbeds(req.body.testbeds);
    if (testbeds) enterprise.testbeds = testbeds;

    await enterprise.save();
    res.json(enterprise);
  })
);

module.exports = router;