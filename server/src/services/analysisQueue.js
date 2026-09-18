/**
 * analysisQueue.js — in-process background runner for Feature 1.
 *
 * POST /api/problems must answer immediately (the citizen is waiting on a
 * phone), so the AI factor extraction is enqueued here and the response goes out
 * with analysisStatus='pending'. Jobs are deduplicated by problem id and capped
 * at ANALYSIS_QUEUE_CONCURRENCY (default 2) so a burst of submissions cannot
 * fire 200 simultaneous Grok calls.
 *
 * NOTE ON SCALE: a plain array + setImmediate/setTimeout is the right amount of
 * machinery at the current volume — no extra dependency, no Redis to run. This
 * is the seam to replace with BullMQ (or any real queue) as soon as the work
 * needs to survive a restart, run on more than one instance, or gain retries
 * with backoff. Keep the enqueueProblemAnalysis() signature stable if you do.
 */
const Problem = require("../models/Problem");
const { analyzeProblem } = require("./aiAnalyzer");

const pendingIds = [];
const inFlight = new Set();
let active = 0;

function concurrency() {
  const configured = Number(process.env.ANALYSIS_QUEUE_CONCURRENCY);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 2;
}

function recoverEnabled() {
  return String(process.env.ANALYSIS_RECOVER_ON_BOOT || "true").toLowerCase() !== "false";
}

function schedule() {
  while (active < concurrency() && pendingIds.length) {
    const id = pendingIds.shift();
    // Re-checked here as well as in enqueue: the doc may have been analysed by a
    // concurrent job (or deleted) between enqueue and dispatch.
    if (inFlight.has(id)) continue;
    active += 1;
    inFlight.add(id);
    setImmediate(() => {
      runProblemAnalysis(id)
        .catch((err) => console.error(`[analysis-queue] ${id} failed:`, err && err.message ? err.message : err))
        .finally(() => {
          active -= 1;
          inFlight.delete(id);
          schedule();
        });
    });
  }
}

/** Queues one problem for AI factor extraction. Idempotent per problem id. */
function enqueueProblemAnalysis(problemId) {
  const id = String(problemId || "").trim().toUpperCase();
  if (!id) return false;
  if (inFlight.has(id) || pendingIds.includes(id)) return false;
  pendingIds.push(id);
  schedule();
  return true;
}

/**
 * The job itself. analyzeProblem() never throws, so the only failure modes here
 * are database errors — logged and dropped rather than retried: the
 * deterministic score is already saved, so a lost refinement is never a lost
 * grievance.
 */
async function runProblemAnalysis(problemId) {
  const problem = await Problem.findOne({ id: String(problemId || "").toUpperCase() });
  if (!problem) {
    console.warn(`[analysis-queue] ${problemId} no longer exists — job dropped`);
    return { skipped: "not_found" };
  }

  const result = await analyzeProblem(problem);

  problem.aiFactors = result.aiFactors;
  problem.aiPriorityScore = result.aiPriorityScore;
  problem.finalPriorityScore = result.finalPriorityScore;
  problem.priorityScore = result.priorityScore;
  problem.priorityTier = result.priorityTier;
  problem.priorityLabel = result.priorityLabel;
  problem.priorityReasons = result.priorityReasons;
  problem.analysisStatus = result.analysisStatus;
  problem.analyzedAt = result.analyzedAt;
  problem.aiProviderUsed = result.provider === "grok" ? "grok" : "local_rules";
  problem.aiMeta = { provider: result.provider, model: result.model, analyzedAt: result.analyzedAt };
  await problem.save();

  console.log(
    `[analysis-queue] ${problem.id} status=${result.analysisStatus} provider=${result.provider} ` +
      `final=${result.finalPriorityScore} tier=${result.priorityTier} latency=${result.latencyMs}ms`
  );
  return {
    status: result.analysisStatus,
    finalPriorityScore: result.finalPriorityScore,
    priorityTier: result.priorityTier,
  };
}

/**
 * Requeues jobs that were still 'pending' when the process last stopped.
 * Without this, a crash between the 201 response and the background save would
 * leave a grievance marked pending forever. Bounded on purpose: boot must not
 * turn into a 5000-call Grok storm after a long outage.
 */
async function recoverPendingAnalyses({ limit = 25 } = {}) {
  if (!recoverEnabled()) return 0;
  const stuck = await Problem.find({ analysisStatus: "pending" }).sort({ createdAt: -1 }).limit(limit).select("id");
  stuck.forEach((doc) => enqueueProblemAnalysis(doc.id));
  if (stuck.length) console.log(`[analysis-queue] recovered ${stuck.length} pending analysis job(s)`);
  return stuck.length;
}

/** Waits for the queue to empty. Used by tests and graceful shutdown. */
async function drainQueue(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while ((pendingIds.length > 0 || active > 0) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return pendingIds.length === 0 && active === 0;
}

function snapshot() {
  return { queued: pendingIds.length, active, inFlight: [...inFlight], concurrency: concurrency() };
}

module.exports = {
  enqueueProblemAnalysis,
  runProblemAnalysis,
  recoverPendingAnalyses,
  drainQueue,
  snapshot,
};