/** * matchEngine.js — Feature 2 startup ↔ grievance matching. * * Two-stage design keeps cost flat regardless of catalog size: *   1. Application-side cosine similarity shortlists the top 10 problems for a *      startup (or MongoDB Atlas Vector Search if available on the cluster). *   2. A single batched Grok-3-mini call scores those 10 candidates against the *      startup profile, producing { problemId, matchScore 0-100, reason <=25 words }. * * If the LLM call fails, the feature degrades gracefully: top 10 by raw cosine * similarity are returned with reason="based on profile similarity". * * Batch cadence: generateMatches() is called on startup profile save and on a * daily cron. We do NOT fire an LLM call per problem per startup (O(n×m×cost)). */

const Problem = require("../models/Problem");
const StartupProfile = require("../models/StartupProfile");
const Match = require("../models/Match");
const { embedText, cosineSimilarity, isEmbeddingConfigured, EMBEDDING_DIMENSIONS, toPlainArray } = require("../services/embeddingService");
const { aiConfig } = require("./aiConfig");
const { providerError } = require("./providerError");
const aiMetrics = require("./aiMetrics");

const SHORTLIST_SIZE = 10;
const LLM_TIMEOUT_MS = 12000;

function profileTextForEmbedding(profile) {
  const parts = [
    profile.profile?.interests?.join(", "),
    profile.profile?.sectors?.join(", "),
    profile.profile?.pastProjects?.join("; "),
    profile.companyName,
    profile.about,
    profile.sectors?.join(", "),
  ].filter(Boolean);
  return parts.join(" ").trim();
}

function problemTextForEmbedding(problem) {
  return [problem.title, problem.description, problem.category].filter(Boolean).join(" ").trim();
}

async function generateStartupEmbedding(profile) {
  if (!isEmbeddingConfigured()) {
    console.warn(`[embedding] OPENAI_API_KEY not configured — skipping embedding for ${profile.identifier}`);
    return { skipped: "not_configured" };
  }
  const text = profileTextForEmbedding(profile);
  const vector = await embedText(text);
  const plain = toPlainArray(vector);
  await StartupProfile.findOneAndUpdate(
    { identifier: profile.identifier },
    { embedding: plain, embeddingModel: EMBEDDING_MODEL, embeddedAt: new Date() },
    { new: true }
  );
  console.log(`[embedding] refreshed embedding for startup ${profile.identifier}`);
  return { success: true, model: EMBEDDING_MODEL };
}

async function generateProblemEmbedding(problem) {
  if (!isEmbeddingConfigured()) {
    console.warn(`[embedding] OPENAI_API_KEY not configured — skipping embedding for ${problem.id}`);
async function scoreShortlistWithLlm(profile, shortlist) {
  const cfg = aiConfig();
  const key = cfg.xaiKey;
  if (!key) {
    throw providerError("grok", "other", 500, "Grok key (XAI_API_KEY / AI_API_KEY) is not set");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const candidatesText = shortlist
      .map(
        (item, idx) =>
          `${idx + 1}. Problem ${item.problemId}: "${item.title}" — ${item.description.slice(0, 300)} [Category: ${item.category}, District: ${item.district}, Priority: ${item.priorityLabel}]`
      )
      .join("\n\n");

    const profileText = [
      `Company: ${profile.companyName}`,
      `About: ${profile.about || "N/A"}`,
      `Interests: ${(profile.profile?.interests || []).join(", ") || "N/A"}`,
      `Sectors: ${(profile.profile?.sectors || []).join(", ") || profile.sectors?.join(", ") || "N/A"}`,
      `Stage: ${profile.profile?.stage || "N/A"}`,
      `Capacity: ${profile.profile?.capacity || "N/A"}`,
      `Past Projects: ${(profile.profile?.pastProjects || []).join("; ") || "N/A"}`,
    ].filter(Boolean).join("\n");

    const prompt = [
      "You are a startup-grievance matching engine for Jharkhand Samadhan Setu.",
      "Given a startup profile and a shortlist of 10 civic grievance problems, score how well each problem matches the startup's expertise and capacity.",
      "Reply with ONLY a JSON array of objects, no prose, no markdown fences.",
      'Each object: { "problemId": "JH-2024-XXXXX", "matchScore": 0-100, "reason": "<=25 words explaining why" }',
      "matchScore: 0 = no fit, 100 = perfect fit for the startup's capabilities.",
      "Consider: sector alignment, problem complexity vs capacity, geographic relevance, past project experience.",
      "",
      `STARTUP PROFILE:`,
      profileText,
      "",
      `PROBLEM SHORTLIST (score each):`,
      candidatesText,
    ].join("\n");

    const response = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        max_tokens: 2000,
        messages: [
          { role: "system", content: "You return ONLY a JSON array of match scores. No other text." },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw providerError(
        "grok",
        response.status === 429 ? "rate_limit" : response.status >= 500 ? "other" : "invalid_response",
        response.status,
        `Grok HTTP ${response.status}`
      );
    }

    const body = await response.json();
    const msg = body.choices?.[0]?.message?.content;
    if (!msg) throw new Error("Grok returned empty content");

    // Extract JSON array from response
    const jsonMatch = msg.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("Could not extract JSON array from Grok response");

    const scores = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(scores)) throw new Error("Grok response is not a JSON array");

    return scores
      .filter((item) => item && item.problemId && typeof item.matchScore === "number")
      .map((item) => ({
        problemId: item.problemId,
        matchScore: Math.max(0, Math.min(100, Math.round(item.matchScore))),
        reason: String(item.reason || "").slice(0, 250),
      }));
  } finally {
    clearTimeout(timer);
  }
}
    return { skipped: "not_configured" };
  }
  const text = problemTextForEmbedding(problem);
  const vector = await embedText(text);
  const plain = toPlainArray(vector);
  await Problem.findOneAndUpdate(
    { id: problem.id },
    { embedding: plain, embeddingModel: EMBEDDING_MODEL, embeddedAt: new Date() },
    { new: true }
  );
  console.log(`[embedding] refreshed embedding for problem ${problem.id}`);
  return { success: true, model: EMBEDDING_MODEL };
}
