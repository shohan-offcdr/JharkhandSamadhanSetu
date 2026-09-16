/**
 * mock-data.js
 * ---------------------------------------------------------
 * FAKE / DEMO DATA ONLY.
 * This file exists so the site has something to show before
 * your real backend + database is connected.
 *
 * LATER: delete this file's data arrays and instead fetch
 * real data from your Express API, e.g.:
 *   const problems = await fetch('/api/problems').then(r => r.json());
 * ---------------------------------------------------------
 */

const SEED_PROBLEMS = [
  // Curated fallback only (2 items). Everything else on the student portal
  // comes live from the API: POST /api/problems categorises, dedupes and
  // prioritises each citizen grievance, and GET /api/problems?audience=student
  // lists the result sorted by priorityScore.
  {
    id: "JH-2024-10312",
    title: "Kanke Water Pipeline Leakage causing road damage",
    titleHi: "काँके पाइपलाइन रिसाव से सड़क क्षति",
    category: "Drinking Water & Sanitation",
    district: "Ranchi",
    block: "Kanke",
    gramPanchayat: "Kanke GP",
    pincode: "834006",
    scaleOfImpact: "Specific Neighbourhood",
    durationDays: 12,
    description: "A major pipeline joint near the Kanke Dam road has been leaking continuously for the last 12 days, damaging the road surface and wasting large volumes of treated water.",
    problemStatement: "A leaking pipeline joint near Kanke Dam road is wasting treated water and damaging the road — a live citizen grievance auto-categorised and prioritised by the API.",
    enrichedDescription: "A major pipeline joint near the Kanke Dam road has been leaking continuously for the last 12 days, damaging the road surface and wasting large volumes of treated water.",
    priorityLabel: "Critical",
    priorityReasons: ["Scale: Specific Neighbourhood", "Pending 12 day(s)", "42 citizen reports"],
    reportCount: 42,
    priorityScore: 91,
    status: "Verified",
    createdAt: "2024-05-01",
  },
  {
    id: "JH-2024-10276",
    title: "No ambulance service reaching Simdega remote blocks",
    titleHi: "सिमडेगा के सुदूर प्रखंडों में एम्बुलेंस सेवा उपलब्ध नहीं",
    category: "Health & Family Welfare",
    district: "Simdega",
    block: "Bano",
    gramPanchayat: "Bano GP",
    pincode: "835223",
    scaleOfImpact: "Multiple Villages",
    durationDays: 30,
    description: "108 ambulance service does not reach several remote hamlets due to poor road connectivity, forcing patients to be carried on makeshift stretchers.",
    problemStatement: "Remote hamlets in Bano block cannot access 108 ambulance service — a live citizen grievance auto-categorised and prioritised by the API.",
    enrichedDescription: "108 ambulance service does not reach several remote hamlets due to poor road connectivity, forcing patients to be carried on makeshift stretchers.",
    priorityLabel: "Critical",
    priorityReasons: ["Scale: Multiple Villages", "Pending 30 day(s)", "63 citizen reports"],
    reportCount: 63,
    priorityScore: 97,
    status: "Escalated",
    createdAt: "2024-04-20",
  },
];

const SEED_STUDENT_PROJECTS = [
  { id: "PRJ-001", title: "Low-cost leak detection sensor for rural pipelines", stage: "Prototyping", team: "TeamJal", university: "BIT Mesra" },
  { id: "PRJ-002", title: "Solar-backed transformer monitoring unit", stage: "University Approved", team: "PowerGrid Club", university: "NIT Jamshedpur" },
];

const SEED_STARTUP_COLLABS = [
  { id: "COL-001", project: "Low-cost leak detection sensor for rural pipelines", partner: "AquaSense Pvt Ltd", stage: "Funding Matched" },
];

// Simple localStorage-backed "table" helpers so the demo persists across page loads.
// The problems table intentionally migrates down to the 2-item curated fallback:
// if an older visit stored 3-4 pre-added challenges, drop the removed ones so the
// student portal only ever shows the 2 curated items + live API grievances.
function seedIfEmpty(key, seedData) {
  if (!localStorage.getItem(key)) {
    localStorage.setItem(key, JSON.stringify(seedData));
  }
}

function migrateProblemsToCuratedFallback() {
  try {
    const raw = localStorage.getItem("jss_problems");
    if (!raw) {
      localStorage.setItem("jss_problems", JSON.stringify(SEED_PROBLEMS));
      return;
    }
    const stored = JSON.parse(raw);
    if (!Array.isArray(stored)) {
      localStorage.setItem("jss_problems", JSON.stringify(SEED_PROBLEMS));
      return;
    }
    const keepIds = new Set(SEED_PROBLEMS.map((p) => p.id));
    // Keep the 2 curated fallbacks (refresh their fields) + any citizen grievance
    // created through the API flow (ids not in the old 4-item seed set).
    const removedSeedIds = stored
      .filter((p) => p && !keepIds.has(p.id) && /^JH-2024-10(298|250)$/.test(String(p.id || "")))
      .map((p) => p.id);
    if (removedSeedIds.length || stored.length !== new Set(stored.map((p) => p && p.id)).size) {
      const curatedById = Object.fromEntries(SEED_PROBLEMS.map((p) => [p.id, p]));
      const seen = new Set();
      const next = [];
      for (const item of stored) {
        if (!item || !item.id || seen.has(item.id)) continue;
        if (/^JH-2024-10(298|250)$/.test(String(item.id))) continue; // removed pre-added challenge
        seen.add(item.id);
        next.push(curatedById[item.id] || item);
      }
      for (const seed of SEED_PROBLEMS) {
        if (!seen.has(seed.id)) {
          seen.add(seed.id);
          next.push(seed);
        }
      }
      localStorage.setItem("jss_problems", JSON.stringify(next));
    }
  } catch {
    localStorage.setItem("jss_problems", JSON.stringify(SEED_PROBLEMS));
  }
}

migrateProblemsToCuratedFallback();
seedIfEmpty("jss_student_projects", SEED_STUDENT_PROJECTS);
seedIfEmpty("jss_startup_collabs", SEED_STARTUP_COLLABS);
