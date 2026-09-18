/**
 * analyzeHelpers.js — prompt building, JSON extraction, and schema
 * normalization shared by the AI providers and the local-rules fallback.
 *
 * Factored out of aiAnalyzer.js so the per-provider adapters can import these
 * without creating a circular dependency (providers -> aiAnalyzer -> providers).
 */
const {
  CATEGORY_VALUES,
  analyzeProblem,
  tokenize,
  normalizeDedupKey,
  priorityLabelFor,
} = require("../utils/categorize");

function buildAnalysisPrompt(input) {
  const title = input.title || "";
  const description = input.description || "";
  const district = input.district || "";
  const block = input.block ? `, Block: ${input.block}` : "";
  return [
    "You are a civic-grievance analyst for Jharkhand Samadhan Setu (Jharkhand, India).",
    "Classify the grievance, rewrite it as a clear student-facing problem statement, and score its priority.",
    "",
    `Title: ${title}`,
    `Citizen description: ${description}`,
    `District: ${district}${block}`,
    `Scale of impact: ${input.scaleOfImpact || "unknown"}`,
    `Duration (days): ${Number(input.durationDays || 0)}`,
    `Duplicate reports so far: ${Number(input.reportCount || 1)}`,
    `Photo evidence attached: ${Number(input.photoCount || 0) > 0 ? "yes" : "no"}`,
    "",
    `Allowed categories (pick EXACTLY one): ${CATEGORY_VALUES.join(" | ")}`,
    "Priority 0-100: weigh population affected (scale), duration waited, health/safety risk of the category, duplicate report volume, and whether photo evidence exists.",
    "80+=Critical, 60+=High, 35+=Medium, else Low.",
    "List every factor you weighed in priorityReasons so students see why it ranks where it does.",
    "Respond with ONLY valid JSON, no markdown fences, matching this schema:",
    '{"category":"<one of allowed>","categoryConfidence":0.0-1.0,',
    '"problemStatement":"2-3 sentence student brief, max 800 chars",',
    '"enrichedDescription":"full clear description with who/where/since/impact, max 2000 chars",',
    '"priorityScore":0-100,"priorityLabel":"Critical|High|Medium|Low",',
    '"priorityReasons":["short reason"], "dedupKey":"normalized 5-10 word signature"}',
  ].join("\n");
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(unfenced.slice(start, end + 1));
    throw new Error("AI returned non-JSON");
  }
}

const PRIORITY_LABELS = ["Critical", "High", "Medium", "Low"];

function sanitizeAnalysis(raw, input) {
  const category = CATEGORY_VALUES.includes(raw.category) ? raw.category : "Other";
  const score = Math.max(0, Math.min(100, Math.round(Number(raw.priorityScore) || 0)));
  const clampText = (v, max, fb) => String(v || fb || "").trim().slice(0, max);
  const reasons = Array.isArray(raw.priorityReasons)
    ? raw.priorityReasons.map((r) => String(r).trim().slice(0, 160)).filter(Boolean).slice(0, 5)
    : [];
  return {
    category,
    categoryConfidence: Math.max(0, Math.min(1, Number(raw.categoryConfidence ?? 0.7))),
    problemStatement: clampText(raw.problemStatement, 800, input.description),
    enrichedDescription: clampText(raw.enrichedDescription, 2000, input.description),
    priorityScore: score,
    priorityLabel: PRIORITY_LABELS.includes(raw.priorityLabel)
      ? raw.priorityLabel
      : priorityLabelFor(score),
    priorityReasons: reasons,
    dedupKey: normalizeDedupKey(raw.dedupKey || `${input.title} ${input.description}`),
    district: String(input.district || "").trim().toLowerCase(),
    tokens: tokenize(`${input.title || ""} ${input.description || ""} ${raw.dedupKey || ""}`),
    analysisVersion: "ai-v1",
  };
}

// Defensive validation: providers are not trusted blindly. Re-runs after
// sanitizeAnalysis is idempotent (sanitizeAnalysis already coerces everything to
// a valid shape), but this also guards against a provider returning a missing
// key or a wrong type on the edge fields sanitizeAnalysis doesn't touch.
const REQUIRED_FACTORS = [
  "category",
  "categoryConfidence",
  "problemStatement",
  "enrichedDescription",
  "priorityScore",
  "priorityLabel",
  "priorityReasons",
  "dedupKey",
  "district",
  "analysisVersion",
];

function validateAiFactors(obj) {
  if (!obj || typeof obj !== "object") {
    throw new Error("AI provider returned a non-object response");
  }
  const missing = REQUIRED_FACTORS.filter((key) => !(key in obj));
  if (missing.length) {
    throw new Error(`AI provider response missing required field(s): ${missing.join(", ")}`);
  }
  if (typeof obj.priorityScore !== "number" || Number.isNaN(obj.priorityScore)) {
    throw new Error("AI provider returned a non-numeric priorityScore");
  }
  if (!Array.isArray(obj.priorityReasons)) {
    throw new Error("AI provider returned a non-array priorityReasons");
  }
  return obj;
}

module.exports = {
  buildAnalysisPrompt,
  extractJson,
  sanitizeAnalysis,
  validateAiFactors,
  analyzeProblem,
  CATEGORY_VALUES,
  tokenize,
  normalizeDedupKey,
  priorityLabelFor,
};
