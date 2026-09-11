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
    description:
      "A major pipeline joint near the Kanke Dam road has been leaking continuously for the last 12 days, damaging the road surface and wasting large volumes of treated water.",
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
    description:
      "The village transformer burnt out and has not been replaced. Around 150 households are without power, affecting irrigation pumps and children's studies at night.",
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
    description:
      "108 ambulance service does not reach several remote hamlets due to poor road connectivity, forcing patients to be carried on makeshift stretchers.",
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

  console.log(`[seed] done. created: ${created}, updated: ${updated}`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
