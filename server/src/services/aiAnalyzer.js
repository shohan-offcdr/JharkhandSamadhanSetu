/**
 * aiAnalyzer.js — server-only xAI Grok enrichment for grievances.
 * Browser must never see AI_API_KEY, so every Grok call happens here.
 * analyzeGrievance() NEVER throws: missing key / timeout / bad JSON all
 * fall back to local rules with analysisVersion "local-semantic-v2".
 */
const {
  CATEGORY_VALUES,
  analyzeProblem,
  tokenize,
  normalizeDedupKey,
  priorityLabelFor,
} = require("../utils/categorize");

const DEFAULT_MODEL = "grok-3-mini";

function aiConfig() {
  return {
    url: process.env.AI_API_URL || "https://api.x.ai/v1/chat/completions",
    key: process.env.AI_API_KEY || "",
    model: process.env.AI_MODEL || DEFAULT_MODEL,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 15000),
    provider: process.env.AI_PROVIDER || "xai",
  };
}

function isAiConfigured() {
  return Boolean(aiConfig().key);
}

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
    priorityLabel: ["Critical", "High", "Medium", "Low"].includes(raw.priorityLabel)
      ? raw.priorityLabel
      : priorityLabelFor(score),
    priorityReasons: reasons,
    dedupKey: normalizeDedupKey(raw.dedupKey || `${input.title} ${input.description}`),
    district: String(input.district || "").trim().toLowerCase(),
    tokens: tokenize(`${input.title || ""} ${input.description || ""} ${raw.dedupKey || ""}`),
    analysisVersion: "ai-v1",
  };
}

function fallbackAnalysis(input) {
  const local = analyzeProblem(input);
  const text = `${input.title || ""} ${input.description || ""}`.trim();
  return {
    category: local.category,
    categoryConfidence: 0.5,
    problemStatement: text.slice(0, 800),
    enrichedDescription: text.slice(0, 2000),
    priorityScore: local.priorityScore,
    priorityLabel: priorityLabelFor(local.priorityScore),
    priorityReasons: local.priorityReasons && local.priorityReasons.length
      ? local.priorityReasons
      : [
        input.scaleOfImpact ? `Scale: ${input.scaleOfImpact}` : "Scale not specified",
        `Pending ${Number(input.durationDays || 0)} day(s)`,
      ],
    dedupKey: normalizeDedupKey(`${input.title} ${input.description}`),
    district: local.district,
    tokens: local.tokens,
    analysisVersion: "local-semantic-v2",
  };
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

async function fetchGrokAnalysis(input) {
  const cfg = aiConfig();
  if (!cfg.key) throw new Error("AI_API_KEY is not set");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const response = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        max_tokens: 900,
        messages: [
          { role: "system", content: "You classify civic grievances and always reply with only valid JSON." },
          { role: "user", content: buildAnalysisPrompt(input) },
        ],
      }),
      signal: controller.signal,
    });
    const body = await response.text().catch(() => "");
    // Billing/quota/permission failures are permanent for this key: log the
    // provider's own message once (first 200 chars, never the key) and fall
    // back, instead of retrying a call that can never succeed.
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      console.warn(`[ai] Grok unavailable (HTTP ${response.status}): ${body.slice(0, 200)}`);
      const err = new Error(`AI provider HTTP ${response.status}`);
      err.permanent = true;
      throw err;
    }
    if (!response.ok) throw new Error(`AI provider HTTP ${response.status}`);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error("AI provider returned non-JSON envelope");
    }
    const msg = parsed.choices && parsed.choices[0] && parsed.choices[0].message;
    if (!msg || !msg.content) throw new Error("AI provider returned empty content");
    const analysis = sanitizeAnalysis(extractJson(msg.content), input);
    analysis.aiMeta = { provider: cfg.provider, model: cfg.model, analyzedAt: new Date() };
    return analysis;
  } finally {
    clearTimeout(timer);
  }
}

// Never throws: AI failure degrades to local rules so a citizen submission is
// never lost because Grok was down / slow / misconfigured.
async function analyzeGrievance(input) {
  if (!isAiConfigured()) return fallbackAnalysis(input);
  try {
    return await fetchGrokAnalysis(input);
  } catch (err) {
    console.warn("[ai] Grok analysis failed, using local rules:", err.message);
    return fallbackAnalysis(input);
  }
}

module.exports = { analyzeGrievance, isAiConfigured, aiConfig, buildAnalysisPrompt, fallbackAnalysis };

