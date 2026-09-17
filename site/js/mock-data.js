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
  {
    id: "JH-2024-10001",
    title: "Main water pipeline burst near Doranda Market",
    category: "Drinking Water & Sanitation",
    district: "Ranchi", block: "Doranda", gramPanchayat: "Doranda GP", pincode: "834002",
    scaleOfImpact: "Specific Neighbourhood", durationDays: 8,
    description: "The main JJMB water pipeline near Doranda market has been leaking for 8 days. Around 200 households have no clean water supply. Women are collecting water from a pond 2km away.",
    reportCount: 34, priorityScore: 88, status: "Pending Verification", createdAt: "2024-06-01"
  },
  {
    id: "JH-2024-10002",
    title: "No electricity for 10 days after transformer failure",
    category: "Electricity & JBVNL",
    district: "Dhanbad", block: "Jharia", gramPanchayat: "Jharia GP", pincode: "828111",
    scaleOfImpact: "Village", durationDays: 10,
    description: "The 100KVA distribution transformer in Jharia ward 7 burnt on June 3rd. JBVNL has not replaced it. 300+ households including a primary school and health sub-centre are without power.",
    reportCount: 51, priorityScore: 92, status: "Verified", createdAt: "2024-06-03"
  },
  {
    id: "JH-2024-10003",
    title: "Bridge on Karo River collapsed blocking 6 villages",
    category: "Roads & Infrastructure",
    district: "Simdega", block: "Bano", gramPanchayat: "Bano GP", pincode: "835223",
    scaleOfImpact: "Multiple Villages", durationDays: 21,
    description: "The kutcha bridge over Karo river collapsed 3 weeks ago during rains. 6 villages are completely cut off. Ambulance cannot reach. Students cannot attend school. Farmers cannot transport produce.",
    reportCount: 89, priorityScore: 97, status: "Escalated", createdAt: "2024-05-20"
  },
  {
    id: "JH-2024-10004",
    title: "Primary Health Centre doctor absent for 2 months",
    category: "Health & Family Welfare",
    district: "Gumla", block: "Bharno", gramPanchayat: "Bharno GP", pincode: "835207",
    scaleOfImpact: "Village", durationDays: 60,
    description: "The only MBBS doctor at Bharno PHC has not reported for duty for 2 months. Pregnant women and seriously ill patients travel 40km to Gumla district hospital. One maternal death reported last month.",
    reportCount: 42, priorityScore: 95, status: "Pending Verification", createdAt: "2024-04-15"
  },
  {
    id: "JH-2024-10005",
    title: "Mid-day meal not served for 3 weeks at Govt school",
    category: "Education",
    district: "Bokaro", block: "Chandankiyari", gramPanchayat: "Chandankiyari GP", pincode: "829201",
    scaleOfImpact: "Specific Neighbourhood", durationDays: 21,
    description: "Rajkiya Madhya Vidyalaya Chandankiyari has not served mid-day meals for 3 weeks due to funds not released. 180 children from BPL families depend on this meal. Attendance has dropped sharply.",
    reportCount: 17, priorityScore: 74, status: "Verified", createdAt: "2024-05-25"
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
