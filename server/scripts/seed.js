/**
 * Demo-content seed for a fresh database.
 *
 * Two goals:
 *  1. Push the demo grievances the frontend used to fake with localStorage into
 *     the real MongoDB collection, so IDs like JH-2024-10312 keep working once
 *     the frontend calls GET /api/problems/:id instead of the mock api.js.
 *  2. Create the accounts and partner records the government and startup
 *     portals now read from the API: officer/partner logins (Account),
 *     universities, CSR enterprises, a startup profile, one solution and two
 *     collaborations with milestones.
 *
 * Run with: npm run seed
 * Safe to re-run -- everything is upserted by its own id/identifier, and the
 * printed demo passwords are reset each run.
 */
require("dotenv").config();
const connectDB = require("../src/config/db");
const Problem = require("../src/models/Problem");
const Account = require("../src/models/Account");
const University = require("../src/models/University");
const EnterpriseCsr = require("../src/models/EnterpriseCsr");
const StartupProfile = require("../src/models/StartupProfile");
const Collaboration = require("../src/models/Collaboration");
const Solution = require("../src/models/Solution");
const { hashPassword } = require("../src/utils/password");

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

// Demo logins for the staffed portals. Re-running the seed resets these
// passwords, which is intentional: a fresh clone needs a way in, and the values
// are printed at the end of the run.
const SEED_ACCOUNTS = [
  {
    role: "government",
    identifier: "officer@jharkhand.gov.in",
    password: "jharkhand2026",
    name: "Nodal Officer (IAS)",
    designation: "Nodal Officer",
    organisation: "Department of Administrative Reforms & Public Grievances",
    district: "Ranchi",
  },
  {
    role: "startup",
    identifier: "partner@example.com",
    password: "partner2026",
    name: "CCL Innovation Lab",
    designation: "Head - Innovation Lab",
    organisation: "Central Coalfields Ltd.",
    district: "Ranchi",
  },
];

// Universities page (government portal). The rows the page used to hardcode now
// live here so the table is served from the API.
const SEED_UNIVERSITIES = [
  {
    id: "UN-2024-40101",
    name: "Birla Institute of Technology (BIT), Mesra",
    shortName: "BIT Mesra",
    district: "Ranchi",
    specializations: ["Water Tech", "LoRaWAN", "Structural"],
    coordinatorName: "Dr. S. K. Roy",
    coordinatorEmail: "skroy@bitmesra.example",
    acceptedCount: 28,
    activeCount: 14,
    completedCount: 11,
    performanceScore: 94,
    status: "Active",
  },
  {
    id: "UN-2024-40102",
    name: "National Institute of Technology (NIT), Jamshedpur",
    shortName: "NIT Jamshedpur",
    district: "East Singhbhum",
    specializations: ["Solar Microgrids", "Cryogenics", "Drones"],
    coordinatorName: "Er. Rajesh Linda",
    coordinatorEmail: "rlinda@nitjsr.example",
    acceptedCount: 22,
    activeCount: 12,
    completedCount: 8,
    performanceScore: 92,
    status: "Active",
  },
  {
    id: "UN-2024-40103",
    name: "Indian Institute of Technology (IIT ISM), Dhanbad",
    shortName: "IIT (ISM) Dhanbad",
    district: "Dhanbad",
    specializations: ["Mining Runoff", "Soil Science", "AI"],
    acceptedCount: 19,
    activeCount: 9,
    completedCount: 7,
    performanceScore: 95,
    status: "Active",
  },
  {
    id: "UN-2024-40104",
    name: "Birsa Agricultural University (BAU), Ranchi",
    shortName: "BAU Ranchi",
    district: "Ranchi",
    specializations: ["Sluice Desilting", "Soil Moisture", "Agritech"],
    acceptedCount: 15,
    activeCount: 6,
    completedCount: 5,
    performanceScore: 88,
    status: "Active",
  },
  {
    id: "UN-2024-40105",
    name: "Ranchi University",
    shortName: "Ranchi University",
    district: "Ranchi",
    specializations: ["Public Health", "Social Sciences"],
    acceptedCount: 6,
    activeCount: 3,
    completedCount: 2,
    performanceScore: 81,
    status: "Active",
  },
];

// Industry-CSR page (government portal).
const SEED_ENTERPRISES = [
  {
    id: "CSR-2024-50101",
    enterpriseName: "Central Coalfields Limited (CCL)",
    sector: "Coal & Clean Energy",
    committedAmount: 12000000, // ₹1.20 Cr
    activeProjects: 8,
    complianceStatus: "Compliant",
    testbeds: [{ name: "Piparwar & Kanke", location: "Heavy dewatering pipelines" }],
    contactEmail: "partner@example.com",
    contactName: "CCL Innovation Lab",
    district: "Ranchi",
  },
  {
    id: "CSR-2024-50102",
    enterpriseName: "Tata Steel CSR Foundation",
    sector: "Metallurgy & Water Security",
    committedAmount: 18500000, // ₹1.85 Cr
    activeProjects: 12,
    complianceStatus: "Compliant",
    testbeds: [{ name: "Jamshedpur & West Singhbhum", location: "Subarnarekha discharge bay" }],
    contactEmail: "csr@tatasteel.example",
    district: "East Singhbhum",
  },
  {
    id: "CSR-2024-50103",
    enterpriseName: "Steel Authority of India (SAIL Bokaro)",
    sector: "Heavy Industry & Environment",
    committedAmount: 9500000, // ₹95 L
    activeProjects: 6,
    complianceStatus: "Under Review",
    testbeds: [{ name: "Chas & Damodar", location: "Cooling ponds & slag yards" }],
    contactEmail: "csr@sailbokaro.example",
    district: "Bokaro",
  },
  {
    id: "CSR-2024-50104",
    enterpriseName: "JSW Energy / Jindal",
    sector: "Renewable Solar & Wind",
    committedAmount: 8000000, // ₹80 L
    activeProjects: 6,
    complianceStatus: "Compliance Pending",
    testbeds: [{ name: "Latehar", location: "Solar array microgrids" }],
    contactEmail: "renewables@jsw.example",
    district: "Latehar",
  },
];

// Startup/enterprise profile matching the demo partner account, so the startup
// Company Profile page has something real to load and save.
const SEED_STARTUP_PROFILES = [
  {
    identifier: "partner@example.com",
    companyName: "CCL Innovation Lab",
    organisation: "Central Coalfields Ltd.",
    dlpiNumber: "DPI-JH-2024-000581",
    about:
      "In-house innovation and field-testing unit of Central Coalfields Limited, paired with Jharkhand state departments for water, energy and mine-water reuse pilots.",
    sectors: ["Coal & Clean Energy", "Water Security", "Industrial IoT"],
    capabilities: ["Hydrology surveys", "LoRaWAN telemetry", "Slag & mine-water treatment"],
    labEquipment: ["Flow-loop test rig", "Dewatering pump bay", "IP68 soak chamber"],
    teamSize: 46,
    capacityPerYear: "5 MLD treated discharge",
    investmentMin: 500000,
    investmentMax: 2500000,
    districts: ["Ranchi", "Dhanbad", "Bokaro", "Chatra"],
    contactEmail: "partner@example.com",
    verified: true,
    pastProjects: [
      { title: "Kanke telemetry gateway", district: "Ranchi", year: 2024, outcome: "24 km of pipeline instrumented" },
      { title: "Mine-water reuse pilot", district: "Dhanbad", year: 2023, outcome: "1.2 MLD reused for dust suppression" },
    ],
  },
];

// A solution submitted by the demo partner, so the startup tracking/milestone
// pages and the government review queue are not empty on a fresh database.
const SEED_SOLUTIONS = [
  {
    id: "SL-2024-60101",
    problemId: "JH-2024-10312",
    studentId: "partner@example.com",
    title: "Acoustic leak-detection nodes for the Kanke pipeline",
    summary:
      "Clamp-on acoustic sensors log pressure transients every 15 minutes and flag joint leaks before they wash out the road surface.",
    approach:
      "Six LoRaWAN nodes along the affected stretch, edge filtering on the gateway, and an officer dashboard alert when a transient signature repeats twice.",
    techStack: "LoRaWAN, MEMS pressure sensors, Node.js gateway",
    timelineDays: 90,
    team: "CCL Innovation Lab",
    status: "Under Review",
  },
];

// Two live engagements for the demo partner: the pages that used to show fake
// sprint/funding/milestone rows now read these documents.
const SEED_COLLABORATIONS = [
  {
    id: "COL-2024-70101",
    problemId: "JH-2024-10312",
    solutionId: "SL-2024-60101",
    partnerId: "partner@example.com",
    partnerName: "CCL Innovation Lab",
    universityId: "UN-2024-40101",
    universityName: "Birla Institute of Technology (BIT), Mesra",
    type: "R&D",
    stage: "In Field",
    title: "Acoustic leak-detection pilot on the Kanke main",
    summary: "Joint pilot with BIT Mesra to instrument the leaking Kanke pipeline stretch and validate early leak detection.",
    fundingCommitted: 1250000,
    milestones: [
      { id: "MS-1", name: "Survey and node placement plan", dueDate: "2024-06-10", status: "Completed", progress: 100 },
      { id: "MS-2", name: "Deploy 6 LoRaWAN nodes", dueDate: "2024-07-05", status: "In Progress", progress: 60 },
      { id: "MS-3", name: "Officer alert integration with SDC", dueDate: "2024-08-20", status: "Pending", progress: 0 },
    ],
    messages: [
      { author: "Dr. S. K. Roy", role: "startup", body: "Node firmware v2 handles the damp chamber conditions; field data attached.", at: new Date("2024-06-18") },
      { author: "Nodal Officer (IAS)", role: "government", body: "Approved. Please keep the district water engineer on the alert list.", at: new Date("2024-06-20") },
    ],
    agreements: [
      { title: "Data-sharing MoU with BIT Mesra", status: "Signed", reference: "MoU/JH/2024/118" },
      { title: "Joint IP on sensor firmware", status: "In draft", reference: "IP/JH/2024/044" },
    ],
  },
  {
    id: "COL-2024-70102",
    problemId: "JH-2024-10276",
    partnerId: "partner@example.com",
    partnerName: "CCL Innovation Lab",
    universityId: "UN-2024-40102",
    universityName: "National Institute of Technology (NIT), Jamshedpur",
    type: "CSR",
    stage: "Funding Matched",
    title: "Ambulance access corridor survey for Bano block",
    summary: "CSR-funded road-connectivity survey to find the shortest all-weather route for 108 ambulances in Bano block.",
    fundingCommitted: 480000,
    milestones: [
      { id: "MS-1", name: "Route and connectivity survey", dueDate: "2024-07-01", status: "Completed", progress: 100 },
      { id: "MS-2", name: "Cost estimate for 3 culvert repairs", dueDate: "2024-08-15", status: "Blocked", progress: 25, note: "Awaiting district road division inputs." },
    ],
    messages: [
      { author: "Er. Rajesh Linda", role: "startup", body: "Survey team reached 5 of the 7 hamlets; two remain waterlogged.", at: new Date("2024-07-02") },
    ],
    agreements: [{ title: "CSR escrow release note", status: "Released", reference: "CSR/JH/2024/077" }],
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

  const portalCounts = await seedPortalData();

  console.log(`[seed] done. created: ${created}, updated: ${updated}, removed pre-added: ${pruned.deletedCount || 0}`);
  console.log(
    `[seed] partners: ${portalCounts.universities} universities, ${portalCounts.enterprises} enterprises, ` +
      `${portalCounts.profiles} startup profiles, ${portalCounts.solutions} solutions, ${portalCounts.collaborations} collaborations`
  );
  console.log("[seed] demo logins (password is reset on every seed run):");
  SEED_ACCOUNTS.forEach((account) => {
    console.log(`[seed]   ${account.role.padEnd(10)} ${account.identifier} / ${account.password}`);
  });
  process.exit(0);
}

// Upserts the account/partner tables. Every entity is keyed by its own
// human-facing id (UN-*, CSR-*, COL-*) or identifier, so re-running the seed
// refreshes the demo content without creating duplicates.
async function seedPortalData() {
  for (const account of SEED_ACCOUNTS) {
    await Account.findOneAndUpdate(
      { identifier: account.identifier, role: account.role },
      {
        identifier: account.identifier,
        role: account.role,
        passwordHash: hashPassword(account.password),
        name: account.name,
        designation: account.designation,
        organisation: account.organisation,
        district: account.district,
        status: "active",
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }

  for (const university of SEED_UNIVERSITIES) {
    await University.findOneAndUpdate({ id: university.id }, university, { upsert: true, setDefaultsOnInsert: true });
  }

  for (const enterprise of SEED_ENTERPRISES) {
    await EnterpriseCsr.findOneAndUpdate({ id: enterprise.id }, enterprise, { upsert: true, setDefaultsOnInsert: true });
  }

  for (const profile of SEED_STARTUP_PROFILES) {
    await StartupProfile.findOneAndUpdate({ identifier: profile.identifier }, profile, { upsert: true, setDefaultsOnInsert: true });
  }

  for (const solution of SEED_SOLUTIONS) {
    // $setOnInsert keeps a status an officer already changed from being reset.
    await Solution.findOneAndUpdate({ id: solution.id }, { $setOnInsert: solution }, { upsert: true, setDefaultsOnInsert: true });
  }

  for (const collaboration of SEED_COLLABORATIONS) {
    await Collaboration.findOneAndUpdate(
      { id: collaboration.id },
      { $setOnInsert: collaboration },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }

  return {
    universities: SEED_UNIVERSITIES.length,
    enterprises: SEED_ENTERPRISES.length,
    profiles: SEED_STARTUP_PROFILES.length,
    solutions: SEED_SOLUTIONS.length,
    collaborations: SEED_COLLABORATIONS.length,
  };
}

seed().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
