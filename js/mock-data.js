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
    reportCount: 42,
    priorityScore: 91,
    status: "Verified",
    createdAt: "2024-05-01",
  },
  {
    id: "JH-2024-10298",
    title: "Transformer failure - no electricity for 6 days",
    titleHi: "ट्रांसफार्मर खराब - 6 दिनों से बिजली नहीं",
    category: "Electricity & JBVNL",
    district: "Dhanbad",
    block: "Baliapur",
    gramPanchayat: "Baliapur GP",
    pincode: "828203",
    scaleOfImpact: "Village",
    durationDays: 6,
    description: "The village transformer burnt out and has not been replaced. Around 150 households are without power, affecting irrigation pumps and children's studies at night.",
    reportCount: 27,
    priorityScore: 84,
    status: "Pending Verification",
    createdAt: "2024-05-04",
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
    reportCount: 63,
    priorityScore: 97,
    status: "Escalated",
    createdAt: "2024-04-20",
  },
  {
    id: "JH-2024-10250",
    title: "Broken hand-pump, only water source for hamlet",
    titleHi: "हैंडपंप खराब, बस्ती का एकमात्र जल स्रोत",
    category: "Drinking Water & Sanitation",
    district: "Gumla",
    block: "Bharno",
    gramPanchayat: "Bharno GP",
    pincode: "835207",
    scaleOfImpact: "Individual Household",
    durationDays: 4,
    description: "The only functioning hand-pump for 8 households broke down 4 days ago. Women are walking 2km to fetch water.",
    reportCount: 8,
    priorityScore: 52,
    status: "Pending Verification",
    createdAt: "2024-05-08",
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
function seedIfEmpty(key, seedData) {
  if (!localStorage.getItem(key)) {
    localStorage.setItem(key, JSON.stringify(seedData));
  }
}

seedIfEmpty("jss_problems", SEED_PROBLEMS);
seedIfEmpty("jss_student_projects", SEED_STUDENT_PROJECTS);
seedIfEmpty("jss_startup_collabs", SEED_STARTUP_COLLABS);
