// Same placeholder logic as site/js/api.js's fakeCategorize/fakePriorityScore,
// ported here so the server behaves identically once the frontend switches over.
// LATER: replace fakeCategorize with a real Anthropic-backed classification call.

function fakeCategorize(text) {
  const t = (text || "").toLowerCase();
  if (t.includes("water") || t.includes("pipeline") || t.includes("pani") || t.includes("jal")) return "Drinking Water & Sanitation";
  if (t.includes("electric") || t.includes("transformer") || t.includes("bijli")) return "Electricity & JBVNL";
  if (t.includes("hospital") || t.includes("ambulance") || t.includes("health")) return "Health & Family Welfare";
  if (t.includes("road") || t.includes("bridge")) return "Roads & Infrastructure";
  return "Other";
}

const SCALE_WEIGHTS = {
  "Individual Household": 10,
  "Specific Neighbourhood": 30,
  Village: 50,
  "Multiple Villages": 75,
  "Entire District": 95,
};

function fakePriorityScore({ scaleOfImpact, durationDays }) {
  const base = SCALE_WEIGHTS[scaleOfImpact] || 20;
  const durationBoost = Math.min(Number(durationDays || 0), 30);
  return Math.min(100, base + durationBoost);
}

function generateProblemId() {
  const year = new Date().getFullYear();
  const suffix = Math.floor(10000 + Math.random() * 89999);
  return `JH-${year}-${suffix}`;
}

module.exports = { fakeCategorize, fakePriorityScore, generateProblemId };
