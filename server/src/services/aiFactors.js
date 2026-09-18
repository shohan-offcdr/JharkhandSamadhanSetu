/**
 * aiFactors.js — the `aiFactors` contract used by Feature 1 (AI priority factor
 * extraction).
 *
 * Everything that decides whether an LLM response is *allowed near the database*
 * lives here, so there is exactly one place to audit:
 *
 *   validateAiFactors()       strict schema gate — THROWS on anything off-spec.
 *                             The analyzer treats a throw as "the model was
 *                             unusable" and degrades to Local Rules, so
 *                             unvalidated LLM output can never reach Mongo.
 *   sanitizeAiFactors()       coerces/clamps a *validated* payload into the
 *                             exact shape the Problem schema stores.
 *   aiFactorsFromLocalRules() best-effort factors from utils/categorize.js so a
 *                             missing/rate-limited/broken provider still yields
 *                             a usable — and honestly labelled — factors object.
 *   mergeAiFactors()          folds a duplicate report's factors into the
 *                             original problem's (see the de-dup guard in
 *                             routes/problems.js).
 *
 * No provider is imported here on purpose: providers import THIS module, never
 * the other way round, so there is no require cycle.
 */
const { analyzeProblem: localAnalyze } = require("../utils/categorize");

const EVIDENCE_QUALITY_VALUES = ["none", "weak", "moderate", "strong"];
const EVIDENCE_QUALITY_RANK = { none: 0, weak: 1, moderate: 2, strong: 3 };
const AI_FACTOR_SOURCE_VALUES = ["llm", "local_rules", "inherited"];
const MAX_RISK_TAGS = 8;

// The literal the model must return. Kept as one string so the prompt and the
// validator can never drift apart silently.
const AI_FACTORS_JSON_SPEC =
  '{"urgencyScore":0-100,"estimatedAffectedPeople":0,"categoryRiskConfidence":0-1,' +
  '"evidenceQuality":"none|weak|moderate|strong","riskTags":["short_snake_case_tag"]}';

const FACTOR_SYSTEM_PROMPT = [
  "You are a civic-grievance factor extraction engine for Jharkhand Samadhan Setu (Jharkhand, India).",
  "You extract structured priority factors from a citizen grievance. You do not chat.",
  "Reply with a single JSON object and NOTHING else: no prose, no explanation, no markdown code fences.",
  `The object must match exactly this shape: ${AI_FACTORS_JSON_SPEC}`,
  "- urgencyScore: how urgent this is for the affected people, 0 (cosmetic) to 100 (immediate danger to life).",
  "- estimatedAffectedPeople: your best integer estimate of how many people are affected, 0 if genuinely unknown.",
  "- categoryRiskConfidence: 0-1, how confident you are that the stated category carries the health/safety risk you assumed.",
  "- evidenceQuality: 'none' if the text asserts nothing verifiable, 'weak' for a vague claim, 'moderate' for concrete visible detail (a broken pipe, standing water, a damaged transformer), 'strong' for quantified, dated, verifiable detail.",
  "- riskTags: up to 8 short snake_case tags (e.g. water_contamination, school_closure, electrocution_risk).",
  "All five keys are REQUIRED. Use the number 0 and the string 'none' / empty array rather than null or omitting a key.",
].join("\n");

const EVIDENCE_KEYWORDS = [
  "leak", "leaking", "overflow", "overflowing", "broken", "crack", "cracked", "damaged",
  "collapsed", "collapse", "silt", "garbage", "kachra", "sewage", "contaminated",
  "dead", "death", "injured", "accident", "electrocuted", "short circuit", "sparking",
  "visible", "stagnant", "मलबा", "टूटा", "रिसाव",
];

// Rough population a scale implies. Only used to describe a problem, never to
// substitute for the citizen report signal: the priority base tier already
// encodes scale, so deriving affected-people from it would double-count.
const SCALE_POPULATION_HINT = {
  "Individual Household": 5,
  "Specific Neighbourhood": 250,
  Village: 1500,
  "Multiple Villages": 6000,
  "Entire District": 25000,
};

const CATEGORY_RISK_TAGS = {
  "Health & Family Welfare": ["health_risk"],
  "Drinking Water & Sanitation": ["water_sanitation"],
  "Electricity & JBVNL": ["power_outage"],
  "Roads & Infrastructure": ["infrastructure_access"],
  "Agriculture & Irrigation": ["livelihood_risk"],
  Education: ["education_access"],
  "Environment & Waste": ["environmental_hazard"],
  Other: [],
};

const RISK_KEYWORD_TAGS = [
  { tag: "health_risk", pattern: /disease|illness|fever|diarrh|hospital|death|died|बीमार|मौत/i },
  { tag: "safety_risk", pattern: /accident|injured|electrocut|danger|hazard|सुरक्षा|खतरा/i },
  { tag: "water_contamination", pattern: /contaminat|dirty water|brown water|sewage|गंदा पानी/i },
  { tag: "school_closure", pattern: /school closed|no teacher|midday|mid-day|शिक्षक|स्कूल बंद/i },
];

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function cleanTags(value, maxItems = MAX_RISK_TAGS) {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) =>
      String(tag || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
    )
    .filter((tag) => tag.length > 1)
    .slice(0, maxItems);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
/**
 * Strict gate. Throws — with a message naming the offending field — when the
 * payload is not exactly the aiFactors shape. Deliberately unforgiving: a
 * partially-correct answer is a signal that the model went off-script, and the
 * caller has a working Local Rules fallback, so rejecting is always safe.
 */
function validateAiFactors(raw) {
  if (!isPlainObject(raw)) {
    throw new Error("AI factors must be a JSON object");
  }

  const required = ["urgencyScore", "estimatedAffectedPeople", "categoryRiskConfidence", "evidenceQuality", "riskTags"];
  const missing = required.filter((key) => !(key in raw));
  if (missing.length) {
    throw new Error(`AI factors missing required field(s): ${missing.join(", ")}`);
  }

  if (clampNumber(raw.urgencyScore, 0, 100) === null) {
    throw new Error("AI factors urgencyScore must be a number");
  }
  if (Number(raw.urgencyScore) < 0 || Number(raw.urgencyScore) > 100) {
    throw new Error("AI factors urgencyScore must be within 0-100");
  }
  if (clampNumber(raw.estimatedAffectedPeople, 0, Number.MAX_SAFE_INTEGER) === null) {
    throw new Error("AI factors estimatedAffectedPeople must be a number");
  }
  if (Number(raw.estimatedAffectedPeople) < 0) {
    throw new Error("AI factors estimatedAffectedPeople must not be negative");
  }
  if (clampNumber(raw.categoryRiskConfidence, 0, 1) === null) {
    throw new Error("AI factors categoryRiskConfidence must be a number");
  }
  if (Number(raw.categoryRiskConfidence) < 0 || Number(raw.categoryRiskConfidence) > 1) {
    throw new Error("AI factors categoryRiskConfidence must be within 0-1");
  }
  if (!EVIDENCE_QUALITY_VALUES.includes(String(raw.evidenceQuality || "").toLowerCase())) {
    throw new Error(`AI factors evidenceQuality must be one of: ${EVIDENCE_QUALITY_VALUES.join(", ")}`);
  }
  if (!Array.isArray(raw.riskTags) || raw.riskTags.some((tag) => typeof tag !== "string")) {
    throw new Error("AI factors riskTags must be an array of strings");
  }

  return true;
}

/**
 * Normalizes an ALREADY-VALIDATED payload. Values are clamped rather than
 * rejected here, so a 100.4 urgency becomes 100 instead of losing the factors.
 */
function sanitizeAiFactors(raw, { source = "llm", provider, model } = {}) {
  validateAiFactors(raw);

  const factors = {
    urgencyScore: Math.round(clampNumber(raw.urgencyScore, 0, 100)),
    estimatedAffectedPeople: Math.round(clampNumber(raw.estimatedAffectedPeople, 0, 100000000)),
    categoryRiskConfidence: Number(clampNumber(raw.categoryRiskConfidence, 0, 1).toFixed(2)),
    evidenceQuality: String(raw.evidenceQuality).toLowerCase(),
    riskTags: cleanTags(raw.riskTags),
    source: AI_FACTOR_SOURCE_VALUES.includes(source) ? source : "llm",
  };
  if (provider) factors.provider = String(provider);
  if (model) factors.model = String(model);
  return factors;
}

/**
 * Prompt for the factor-only call. Kept separate from buildAnalysisPrompt()
 * (which asks for classification + rewriting) because this call has a much
 * smaller contract and a much tighter timeout.
 */
function buildFactorPrompt(input = {}) {
  return [
    "Extract the priority factors for this citizen grievance.",
    "",
    `Title: ${input.title || ""}`,
    `Citizen description: ${input.description || ""}`,
    `Category: ${input.category || "unknown"}`,
    `District: ${input.district || ""}${input.block ? `, Block: ${input.block}` : ""}`,
    `Scale of impact (citizen selected): ${input.scaleOfImpact || "not specified"}`,
    `Already waiting (days): ${Math.max(0, Number(input.durationDays || 0))}`,
    `Citizen reports so far: ${Math.max(1, Number(input.reportCount || 1))}`,
    `Photo evidence attached: ${Number(input.photoCount || 0) > 0 ? "yes" : "no"}`,
    "",
    `Reply with ONLY this JSON object: ${AI_FACTORS_JSON_SPEC}`,
  ].join("\n");
}

// "200 families", "500 people", "गांव के लोग" -> a usable population estimate.
function estimateAffectedFromText(text) {
  const match = /(\d[\d,]{0,9})\s*(families|family|households|household|people|persons|villagers|parivar|परिवार|लोग|गांव)/i.exec(
    String(text || "")
  );
  if (!match) return 0;
  const count = Number(String(match[1]).replace(/,/g, ""));
  if (!Number.isFinite(count) || count <= 0) return 0;
  const unit = match[2].toLowerCase();
  const perUnit = /famil|household|parivar|परिवार/.test(unit) ? 5 : 1;
  return Math.min(count * perUnit, 1000000);
}
/**
 * Best-effort factors with zero provider involvement — the terminal fallback
 * for Feature 1 and the "duplicate report" path that must not spend an API call.
 *
 * evidenceQuality is keyword-derived (the text describing visible, concrete
 * damage), and estimatedAffectedPeople is only taken from an explicit number in
 * the citizen's own words, or a small hint from the report count. Scale is
 * deliberately NOT converted into an affected-people estimate: the priority base
 * tier already pays for scale, and counting it twice would inflate every
 * locally-analysed grievance.
 */
function aiFactorsFromLocalRules(input = {}) {
  const text = `${input.title || ""} ${input.description || ""}`;
  const local = localAnalyze(input);
  const photoCount = Math.max(0, Number(input.photoCount || 0));

  const keywordHits = EVIDENCE_KEYWORDS.filter((word) => text.toLowerCase().includes(word)).length;
  let evidenceQuality = "none";
  if (photoCount > 0 || keywordHits >= 3) evidenceQuality = "moderate";
  else if (keywordHits >= 1) evidenceQuality = "weak";

  const fromText = estimateAffectedFromText(text);
  const estimatedAffectedPeople = fromText || Math.max(1, Math.max(1, Number(input.reportCount || 1)) * 5);

  const riskTags = [
    ...new Set([
      ...(CATEGORY_RISK_TAGS[local.category] || []),
      ...RISK_KEYWORD_TAGS.filter((rule) => rule.pattern.test(text)).map((rule) => rule.tag),
    ]),
  ].slice(0, MAX_RISK_TAGS);

  return {
    // The local score already weighs duration + reports + category risk + photos,
    // so it is the most honest "urgency" the rules engine can offer.
    urgencyScore: Math.max(0, Math.min(100, Math.round(Number(local.priorityScore) || 0))),
    estimatedAffectedPeople,
    // Keyword categorization is not a risk judgement; low confidence is the
    // truthful value here and keeps this number out of any high-risk decision.
    categoryRiskConfidence: 0.4,
    evidenceQuality,
    riskTags,
    source: "local_rules",
    localCategory: local.category,
    scalePopulationHint: SCALE_POPULATION_HINT[input.scaleOfImpact] || undefined,
  };
}

/**
 * Folds a duplicate report's factors into the original problem's factors.
 *
 * Weighted by report volume, so the citizen signal that arrives with the
 * duplicate (how many more people just said "me too") moves urgency and
 * confidence, while estimatedAffectedPeople accumulates — each reporter is a
 * data point about the size of the affected population.
 */
function mergeAiFactors(baseFactors = {}, incomingFactors = {}, baseWeight = 1, incomingWeight = 1) {
  const base = isPlainObject(baseFactors) ? baseFactors : {};
  const incoming = isPlainObject(incomingFactors) ? incomingFactors : {};
  const bWeight = Math.max(0, Number(baseWeight) || 0);
  const iWeight = Math.max(0, Number(incomingWeight) || 0);
  const total = bWeight + iWeight || 1;

  const weighted = (key, fallback) => {
    const b = clampNumber(base[key], 0, 1e9);
    const i = clampNumber(incoming[key], 0, 1e9);
    if (b === null && i === null) return fallback;
    if (b === null) return i;
    if (i === null) return b;
    return (b * bWeight + i * iWeight) / total;
  };

  const baseRank = EVIDENCE_QUALITY_RANK[String(base.evidenceQuality || "none")] ?? 0;
  const incomingRank = EVIDENCE_QUALITY_RANK[String(incoming.evidenceQuality || "none")] ?? 0;
  const evidenceRank = Math.max(baseRank, incomingRank);

  return {
    urgencyScore: Math.max(0, Math.min(100, Math.round(weighted("urgencyScore", 0)))),
    estimatedAffectedPeople: Math.round(
      (clampNumber(base.estimatedAffectedPeople, 0, 1e9) || 0) + (clampNumber(incoming.estimatedAffectedPeople, 0, 1e9) || 0)
    ),
    categoryRiskConfidence: Math.max(0, Math.min(1, Number(weighted("categoryRiskConfidence", 0).toFixed(2)))),
    // Evidence accumulates at the level of the best single report: a second
    // vague "me too" must not upgrade a weak claim into a strong one.
    evidenceQuality: EVIDENCE_QUALITY_VALUES.find((value) => EVIDENCE_QUALITY_RANK[value] === evidenceRank) || "none",
    riskTags: cleanTags([...(base.riskTags || []), ...(incoming.riskTags || [])]),
    source: "inherited",
  };
}

module.exports = {
  EVIDENCE_QUALITY_VALUES,
  EVIDENCE_QUALITY_RANK,
  AI_FACTOR_SOURCE_VALUES,
  AI_FACTORS_JSON_SPEC,
  FACTOR_SYSTEM_PROMPT,
  MAX_RISK_TAGS,
  buildFactorPrompt,
  validateAiFactors,
  sanitizeAiFactors,
  aiFactorsFromLocalRules,
  mergeAiFactors,
  estimateAffectedFromText,
  SCALE_POPULATION_HINT,
  CATEGORY_RISK_TAGS,
};