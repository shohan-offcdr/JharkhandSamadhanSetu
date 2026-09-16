/**
 * One-off script: pushes the same demo grievances the frontend currently
 * fakes with localStorage into the real MongoDB collection, so IDs like
 * JH-2024-10312 keep working once the frontend switches to calling
 * GET /api/problems/:id instead of the mock api.js.
 *
 * Run with: npm run seed
 * Safe to re-run -- upserts by `id`, never creates duplicates.
 */
require("dotenv").config();
const connectDB = require("../src/config/db");
const Problem = require("../src/models/Problem");

const SEED_PROBLEMS = [
  // Curated fallback only (2 items). All other student-portal challenges arrive
  // live through POST /api/problems (categorize + duplicate-check + prioritize)
  // and are listed via GET /api/problems?audience=student.
  {
    id: "JH-2024-10312",
    title: "Kanke Water Pipeline Leakage causing road damage",
    titleHi: "काँके पाइपलाइन रिसाव से सड़क क्षति",
    category: "Drinking Water & Sanitation",
    categoryConfidence: 0.92,
    district: "Ranchi",
    block: "Kanke",
    gramPanchayat: "Kanke GP",
    pincode: "834006",
    scaleOfImpact: "Specific Neighbourhood",
    durationDays: 12,
    description:
      "A major pipeline joint near the Kanke Dam road has been leaking continuously for the last 12 days, damaging the road surface and wasting large volumes of treated water.",
    problemStatement:
      "A leaking pipeline joint near Kanke Dam road is wasting treated water and damaging the road surface.",
    enrichedDescription:
      "A major pipeline joint near the Kanke Dam road has been leaking continuously for the last 12 days, damaging the road surface and wasting large volumes of treated water.",
    reportCount: 42,
    priorityScore: 91,
    priorityLabel: "Critical",
    priorityReasons: ["Scale: Specific Neighbourhood", "Pending 12 day(s)", "42 citizen reports"],
    analysisVersion: "local-semantic-v2",
    visibleToStudents: true,
    status: "Verified",
    createdAt: "2024-05-01",
  },
  {
    id: "JH-2024-10276",
    title: "No ambulance service reaching Simdega remote blocks",
    titleHi: "सिमडेगा के सुदूर प्रखंडों में एम्बुलेंस सेवा उपलब्ध नहीं",
    category: "Health & Family Welfare",
    categoryConfidence: 0.94,
    district: "Simdega",
    block: "Bano",
    gramPanchayat: "Bano GP",
    pincode: "835223",
    scaleOfImpact: "Multiple Villages",
    durationDays: 30,
    description:
      "108 ambulance service does not reach several remote hamlets due to poor road connectivity, forcing patients to be carried on makeshift stretchers.",
    problemStatement:
      "Remote hamlets in Bano block cannot access 108 ambulance service due to poor road connectivity.",
    enrichedDescription:
      "108 ambulance service does not reach several remote hamlets due to poor road connectivity, forcing patients to be carried on makeshift stretchers.",
    reportCount: 63,
    priorityScore: 97,
    priorityLabel: "Critical",
    priorityReasons: ["Scale: Multiple Villages", "Pending 30 day(s)", "63 citizen reports", "Health/safety risk"],
    analysisVersion: "local-semantic-v2",
    visibleToStudents: true,
    status: "Escalated",
    createdAt: "2024-04-20",
  },
];

// IDs removed from the old 4-item pre-added set. Re-running the seed deletes them
// from MongoDB so the student portal only ever shows the 2 curated challenges
// plus live citizen grievances submitted through the API.
const REMOVED_SEED_IDS = ["JH-2024-10298", "JH-2024-10250"];

async function seed() {
  await connectDB();
  let created = 0;
  let updated = 0;

  for (const problem of SEED_PROBLEMS) {
    const result = await Problem.findOneAndUpdate({ id: problem.id }, problem, {
      upsert: true,
      new: true,
      rawResult: true,
    });
    if (result.lastErrorObject && result.lastErrorObject.updatedExisting) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  // Prune the removed pre-added challenges so older databases also converge to
  // the 2-item curated set. Citizen grievances submitted via POST /api/problems
  // use freshly generated JH-<year>-<5 digits> ids and are never touched here.
  const pruned = await Problem.deleteMany({ id: { $in: REMOVED_SEED_IDS } });

  console.log(`[seed] done. created: ${created}, updated: ${updated}, removed pre-added: ${pruned.deletedCount || 0}`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
