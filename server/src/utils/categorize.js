// Local rules live here so the grievance pipeline works offline / without an
// AI key. The xAI Grok analyzer in ../services/aiAnalyzer.js wraps these as
// its fallback and reuses priorityLabelFor / normalizeDedupKey.
//
// Priority model (transparent, explainable -- every factor lands in
// priorityReasons on the saved grievance so the student portal can show *why*
// a challenge ranks where it does):
//   1. scaleOfImpact   -> base score (population affected)
//   2. durationDays     -> up to +15 (how long citizens have waited)
//   3. reportCount      -> up to +15 (duplicate/\"me too\" volume)
//   4. category risk    -> health/safety +10, water/electric/roads +6
//   5. photo evidence   -> +4 when the citizen attached at least one photo
// Total is clamped to 0-100; labels: 80+ Critical, 60+ High, 35+ Medium.

const CATEGORY_VALUES = [
  "Drinking Water & Sanitation",
  "Electricity & JBVNL",
  "Health & Family Welfare",
  "Roads & Infrastructure",
  "Education",
  "Agriculture & Irrigation",
  "Environment & Waste",
  "Other",
];

function fakeCategorize(text) {
  const t = (text || "").toLowerCase();
  if (t.includes("water") || t.includes("pipeline") || t.includes("pani") || t.includes("jal") || t.includes("handpump") || t.includes("pump") || t.includes("well") || t.includes("borewell") || t.includes("tap")) return "Drinking Water & Sanitation";
  if (t.includes("electric") || t.includes("transformer") || t.includes("bijli")) return "Electricity & JBVNL";
  if (t.includes("hospital") || t.includes("ambulance") || t.includes("health")) return "Health & Family Welfare";
  if (t.includes("road") || t.includes("bridge")) return "Roads & Infrastructure";
  if (t.includes("school") || t.includes("teacher") || t.includes("college") || t.includes("padhai")) return "Education";
  if (t.includes("crop") || t.includes("irrigation") || t.includes("fasal") || t.includes("khet")) return "Agriculture & Irrigation";
  if (t.includes("waste") || t.includes("garbage") || t.includes("kachra") || t.includes("pollution")) return "Environment & Waste";
  return "Other";
}

function analyzeProblem({ title, description, district, scaleOfImpact, durationDays, reportCount, photoCount, category: categoryOverride }) {
  const text = `${title || ""} ${description || ""}`.toLowerCase();
  const category = categoryOverride && CATEGORY_VALUES.includes(categoryOverride) ? categoryOverride : fakeCategorize(text);
  const scoring = prioritize({ scaleOfImpact, durationDays, reportCount, photoCount, category });
  const tokens = new Set(text.match(/[a-z0-9\u0900-\u097f]{3,}/g) || []);
  return {
    category,
    priorityScore: scoring.score,
    priorityReasons: scoring.reasons,
    district: String(district || "").trim().toLowerCase(),
    tokens,
    analysisVersion: "local-semantic-v2",
  };
}

function tokenize(text) {
  return new Set(String(text || "").toLowerCase().match(/[a-z0-9\u0900-\u097f]{3,}/g) || []);
}

function similarityScore(left, right) {
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / union.size;
}

// Stable normalized signature for dedup comparisons: lowercase, collapsed
// whitespace, stripped punctuation. Used alongside token Jaccard so the AI
// dedupKey and the local path compare the same way.
function normalizeDedupKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

const SCALE_WEIGHTS = {
  "Individual Household": 10,
  "Specific Neighbourhood": 30,
  Village: 50,
  "Multiple Villages": 75,
  "Entire District": 95,
};

// Adds a health/safety-aware, duplicate-aware risk bump to the scale base.
// Returns { score, reasons } so callers (and the student portal) can explain
// exactly which factors pushed a grievance up the queue.
const CATEGORY_RISK_BONUS = {
  "Health & Family Welfare": 10,
  "Drinking Water & Sanitation": 6,
  "Electricity & JBVNL": 6,
  "Roads & Infrastructure": 6,
  "Agriculture & Irrigation": 3,
  Education: 3,
  "Environment & Waste": 3,
  Other: 0,
};

function prioritize({ scaleOfImpact, durationDays, reportCount, photoCount, category } = {}) {
  const reasons = [];
  const base = SCALE_WEIGHTS[scaleOfImpact] || 20;
  reasons.push(scaleOfImpact ? `Scale: ${scaleOfImpact} (base ${base})` : `Scale not specified (base ${base})`);

  const days = Math.max(0, Number(durationDays || 0));
  const durationBoost = Math.min(days, 30) * 0.5; // up to +15
  if (days > 0) reasons.push(`Pending ${days} day(s) (+${Number.isInteger(durationBoost) ? durationBoost : durationBoost.toFixed(1)})`);

  const reports = Math.max(1, Number(reportCount || 1));
  const reportBoost = Math.min(Math.max(reports - 1, 0) * 1.5, 15); // up to +15
  if (reports > 1) reasons.push(`${reports} citizen reports (+${Number.isInteger(reportBoost) ? reportBoost : reportBoost.toFixed(1)})`);

  const riskBoost = CATEGORY_RISK_BONUS[category] || 0;
  if (riskBoost > 0) reasons.push(`Category risk: ${category} (+${riskBoost})`);

  const photos = Math.max(0, Number(photoCount || 0));
  const evidenceBoost = photos > 0 ? 4 : 0;
  if (evidenceBoost) reasons.push(`Photo evidence attached (+${evidenceBoost})`);

  const score = Math.max(0, Math.min(100, Math.round(base + durationBoost + reportBoost + riskBoost + evidenceBoost)));
  return { score, reasons };
}

// Kept returning a plain number so any older caller expecting a score keeps working.
function fakePriorityScore(input = {}) {
  return prioritize(input).score;
}

function priorityLabelFor(score) {
  const n = Number(score || 0);
  if (n >= 80) return "Critical";
  if (n >= 60) return "High";
  if (n >= 35) return "Medium";
  return "Low";
}

function generateProblemId() {
  const year = new Date().getFullYear();
  const suffix = Math.floor(10000 + Math.random() * 89999);
  return `JH-${year}-${suffix}`;
}

function generateSolutionId() {
  const year = new Date().getFullYear();
  const suffix = Math.floor(10000 + Math.random() * 89999);
  return `SL-${year}-${suffix}`;
}

// Same XX-YYYY-##### shape as the grievance/solution ids above, so every entity
// the portals display reads the same way (JH-*, SL-*, UN-*, CSR-*, COL-*).
function generateYearScopedId(prefix) {
  const year = new Date().getFullYear();
  const suffix = Math.floor(10000 + Math.random() * 89999);
  return `${prefix}-${year}-${suffix}`;
}

function generateUniversityId() {
  return generateYearScopedId("UN");
}

function generateEnterpriseId() {
  return generateYearScopedId("CSR");
}

function generateCollaborationId() {
  return generateYearScopedId("COL");
}

module.exports = {
  CATEGORY_VALUES,
  fakeCategorize,
  fakePriorityScore,
  prioritize,
  analyzeProblem,
  tokenize,
  similarityScore,
  normalizeDedupKey,
  priorityLabelFor,
  generateProblemId,
  generateSolutionId,
  generateUniversityId,
  generateEnterpriseId,
  generateCollaborationId,
};

