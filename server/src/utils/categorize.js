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
//
// Feature 1 (AI factor extraction) passes an optional `aiFactors` object as an
// ADDITIONAL INPUT. The weights above are unchanged — aiFactors only changes
// which input a term reads, and only while the citizen-reported data is missing:
//   urgencyScore            -> base tier, when no scale was selected and there is
//                              no duration/report evidence yet (only nudges UP)
//   estimatedAffectedPeople -> the reports-count term, while there are no
//                              corroborating reports (reports = 0/1)
//   evidenceQuality         -> the +4 photo term, when no photo was uploaded but
//                              the text describes visible evidence
// Every substitution is recorded in both `reasons` (for the UI) and the returned
// `factors` breakdown, so a score can always be explained factor by factor.

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

const EVIDENCE_BONUS = 4;

// Substitution constants for the optional aiFactors input. These are NOT new
// weights: they are the existing weights re-read from a different input.
const DEFAULT_SCALE_BASE = 20;
const EVIDENCE_BONUS_QUALITIES = ["moderate", "strong"];
const AFFECTED_PER_EQUIVALENT_REPORT = 500;
const MAX_EQUIVALENT_REPORTS = 11; // same +15 ceiling as the report term

// urgencyScore -> the base tier it most resembles. Every value is lifted from
// SCALE_WEIGHTS, so the AI path and the citizen path land on identical numbers.
const URGENCY_BASE_BANDS = [
  { min: 85, base: SCALE_WEIGHTS["Multiple Villages"] },
  { min: 65, base: SCALE_WEIGHTS.Village },
  { min: 40, base: SCALE_WEIGHTS["Specific Neighbourhood"] },
  { min: 0, base: SCALE_WEIGHTS["Individual Household"] },
];

function urgencyBaseFor(urgencyScore) {
  const value = Number(urgencyScore);
  if (!Number.isFinite(value)) return null;
  const band = URGENCY_BASE_BANDS.find((entry) => value >= entry.min);
  return band ? band.base : null;
}

// Keeps reason strings identical to the pre-AI output ("+7.5", not "+7.50000001").
function formatBoost(value) {
  return Number.isInteger(value) ? value : Number(value.toFixed(1));
}

function prioritize({ scaleOfImpact, durationDays, reportCount, photoCount, category, aiFactors } = {}) {
  const factors = aiFactors && typeof aiFactors === "object" ? aiFactors : {};
  const reasons = [];

  const days = Math.max(0, Number(durationDays || 0));
  // reportCount defaults to 1 the moment a grievance is created, so "no reports
  // at all" arrives here as 1: <=1 is what the sparse case actually looks like.
  const citizenReports = Math.max(1, Number(reportCount || 1));
  const sparse = days <= 0 && citizenReports <= 1;

  const scaleProvided = Object.prototype.hasOwnProperty.call(SCALE_WEIGHTS, scaleOfImpact);
  const urgencyScore = Number(factors.urgencyScore);
  const urgencyBase = urgencyBaseFor(factors.urgencyScore);
  // AI urgency fills the base tier only where the citizen signal is missing, and
  // only when it pushes the tier UP -- a low AI urgency must never lower a score
  // the deterministic formula already justified.
  const useUrgencyBase = !scaleProvided && sparse && urgencyBase !== null && urgencyBase > DEFAULT_SCALE_BASE;
  const base = scaleProvided ? SCALE_WEIGHTS[scaleOfImpact] : useUrgencyBase ? urgencyBase : DEFAULT_SCALE_BASE;

  if (scaleProvided) reasons.push(`Scale: ${scaleOfImpact} (base ${base})`);
  else if (useUrgencyBase) reasons.push(`AI urgency ${Math.round(urgencyScore)}/100 -> base ${base} (no scale given)`);
  else reasons.push(`Scale not specified (base ${base})`);

  const durationBoost = Math.min(days, 30) * 0.5; // up to +15
  if (days > 0) reasons.push(`Pending ${days} day(s) (+${formatBoost(durationBoost)})`);

  // estimatedAffectedPeople stands in for report volume only while there are no
  // corroborating reports: ~500 affected people is worth one report at the
  // existing 1.5-per-report weight, capped at the same +15.
  const affected = Number(factors.estimatedAffectedPeople);
  const affectedEquivalent =
    Number.isFinite(affected) && affected > AFFECTED_PER_EQUIVALENT_REPORT
      ? 1 + Math.min(MAX_EQUIVALENT_REPORTS - 1, Math.floor(affected / AFFECTED_PER_EQUIVALENT_REPORT))
      : 0;
  const reportsFromAffected = citizenReports <= 1 && affectedEquivalent > citizenReports;
  const effectiveReports = reportsFromAffected ? affectedEquivalent : citizenReports;
  const reportBoost = Math.min(Math.max(effectiveReports - 1, 0) * 1.5, 15); // up to +15
  if (reportsFromAffected) reasons.push(`AI estimates ${Math.round(affected)} people affected (+${formatBoost(reportBoost)})`);
  else if (citizenReports > 1) reasons.push(`${citizenReports} citizen reports (+${formatBoost(reportBoost)})`);

  const riskBoost = CATEGORY_RISK_BONUS[category] || 0;
  if (riskBoost > 0) reasons.push(`Category risk: ${category} (+${riskBoost})`);

  const photos = Math.max(0, Number(photoCount || 0));
  const quality = String(factors.evidenceQuality || "").toLowerCase();
  // One flat +4: either a photo was uploaded, or the AI judged the complaint text
  // itself to describe visible evidence. Never both.
  const evidenceFromText = photos === 0 && EVIDENCE_BONUS_QUALITIES.includes(quality);
  const evidenceBoost = photos > 0 || evidenceFromText ? EVIDENCE_BONUS : 0;
  if (photos > 0) reasons.push(`Photo evidence attached (+${evidenceBoost})`);
  else if (evidenceFromText) reasons.push(`AI: ${quality} text evidence (+${evidenceBoost})`);

  const score = Math.max(0, Math.min(100, Math.round(base + durationBoost + reportBoost + riskBoost + evidenceBoost)));
  return {
    score,
    reasons,
    // Per-factor breakdown: the same numbers that produced `score`, in a shape an
    // auditor or the government AI-analysis page can render directly.
    factors: {
      base,
      baseSource: scaleProvided ? "scale" : useUrgencyBase ? "ai_urgency" : "default",
      durationBoost,
      effectiveReports,
      reportBoost,
      reportsSource: reportsFromAffected ? "ai_affected_people" : "citizen_reports",
      riskBoost,
      evidenceBoost,
      evidenceSource: photos > 0 ? "photo" : evidenceFromText ? "ai_text" : "none",
      urgencyScore: Number.isFinite(urgencyScore) ? urgencyScore : undefined,
      estimatedAffectedPeople: Number.isFinite(affected) ? affected : undefined,
      evidenceQuality: quality || undefined,
      categoryRiskConfidence: Number.isFinite(Number(factors.categoryRiskConfidence))
        ? Number(factors.categoryRiskConfidence)
        : undefined,
      aiSource: factors.source || undefined,
    },
  };
}

// Lowercase tier stored in Problem.priorityTier (the Student Portal badge).
// Mirrors priorityLabelFor()'s thresholds exactly, so the two can never disagree.
function priorityTierFor(score) {
  const value = Number(score || 0);
  if (value >= 80) return "critical";
  if (value >= 60) return "high";
  if (value >= 35) return "medium";
  return "low";
}

// The score the AI factors alone justify: no citizen scale, duration, reports or
// photo inputs. Stored as Problem.aiPriorityScore so the deterministic
// finalPriorityScore can be compared against the AI's own view of a grievance.
function aiOnlyPriorityScore({ category, aiFactors } = {}) {
  return prioritize({ category, aiFactors, durationDays: 0, reportCount: 0, photoCount: 0 }).score;
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
  priorityTierFor,
  aiOnlyPriorityScore,
  urgencyBaseFor,
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

