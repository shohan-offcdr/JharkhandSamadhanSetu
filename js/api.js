/**
 * api.js
 * ---------------------------------------------------------
 * This is your "backend" abstraction layer.
 *
 * RIGHT NOW every function reads/writes localStorage, so the
 * site fully works offline as a demo.
 *
 * LATER, when your Node/Express + MongoDB + Anthropic backend
 * is ready, you only need to edit the INSIDE of these functions
 * to call your real API instead — nothing else on any page needs
 * to change, because every page calls these same function names.
 *
 * Example of what a function will look like AFTER you connect
 * your real backend (kept here as a comment for reference):
 *
 *   async function submitProblem(problem) {
 *     const res = await fetch('/api/problems', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify(problem)
 *     });
 *     return res.json();
 *   }
 * ---------------------------------------------------------
 */

const API = {

  // ---------- AUTH ----------

  // Fake login: accepts anything non-empty, stores a session.
  // LATER: replace body with a real fetch('/api/auth/login', ...)
  login(role, identifier) {
    const session = { role, identifier, loggedInAt: new Date().toISOString() };
    localStorage.setItem("jss_session", JSON.stringify(session));
    return session;
  },

  logout() {
    localStorage.removeItem("jss_session");
  },

  getSession() {
    const raw = localStorage.getItem("jss_session");
    return raw ? JSON.parse(raw) : null;
  },

  // ---------- PROBLEMS (Grievances) ----------

  getProblems() {
    return JSON.parse(localStorage.getItem("jss_problems") || "[]");
  },

  getProblemById(id) {
    return this.getProblems().find(p => p.id === id);
  },

  // Called on the final grievance step.
  // LATER: this is where you call your AI categorization endpoint
  // (the /api/problems POST route we built) instead of doing it locally.
  submitProblem(problem) {
    const problems = this.getProblems();

    // very simple demo "AI categorization" - keyword based.
    // LATER: replace this with a real call to your Anthropic-backed route.
    problem.category = this.fakeCategorize(problem.title + " " + problem.description);
    problem.id = "JH-" + new Date().getFullYear() + "-" + Math.floor(10000 + Math.random() * 89999);
    problem.status = "Pending Verification";
    problem.reportCount = 1;
    problem.priorityScore = this.fakePriorityScore(problem);
    problem.createdAt = new Date().toISOString().slice(0, 10);

    problems.unshift(problem);
    localStorage.setItem("jss_problems", JSON.stringify(problems));
    return problem;
  },

  // Placeholder categorizer - swap for real AI call later.
  fakeCategorize(text) {
    const t = text.toLowerCase();
    if (t.includes("water") || t.includes("pipeline") || t.includes("pani") || t.includes("jal")) return "Drinking Water & Sanitation";
    if (t.includes("electric") || t.includes("transformer") || t.includes("bijli")) return "Electricity & JBVNL";
    if (t.includes("hospital") || t.includes("ambulance") || t.includes("health")) return "Health & Family Welfare";
    if (t.includes("road") || t.includes("bridge")) return "Roads & Infrastructure";
    return "Other";
  },

  // Placeholder priority scorer - swap for real AI/rules engine later.
  fakePriorityScore(problem) {
    const scaleWeights = {
      "Individual Household": 10,
      "Specific Neighbourhood": 30,
      "Village": 50,
      "Multiple Villages": 75,
      "Entire District": 95,
    };
    const base = scaleWeights[problem.scaleOfImpact] || 20;
    const durationBoost = Math.min(Number(problem.durationDays || 0), 30);
    return Math.min(100, base + durationBoost);
  },

  // Increase report count when someone reports the "same" issue.
  // LATER: this logic moves to your backend's duplicate-detection route.
  bumpReportCount(problemId) {
    const problems = this.getProblems();
    const p = problems.find(p => p.id === problemId);
    if (p) {
      p.reportCount += 1;
      localStorage.setItem("jss_problems", JSON.stringify(problems));
    }
    return p;
  },

  updateProblemStatus(problemId, status) {
    const problems = this.getProblems();
    const p = problems.find(p => p.id === problemId);
    if (p) {
      p.status = status;
      localStorage.setItem("jss_problems", JSON.stringify(problems));
    }
    return p;
  },

  // sorted by priority, highest first - this is your "priority queue"
  getProblemsByPriority() {
    return this.getProblems().slice().sort((a, b) => b.priorityScore - a.priorityScore);
  },

  // ---------- DRAFT GRIEVANCE (multi-step form state) ----------

  saveDraft(partial) {
    const draft = { ...this.getDraft(), ...partial };
    sessionStorage.setItem("jss_draft_problem", JSON.stringify(draft));
    return draft;
  },

  getDraft() {
    const raw = sessionStorage.getItem("jss_draft_problem");
    return raw ? JSON.parse(raw) : {};
  },

  clearDraft() {
    sessionStorage.removeItem("jss_draft_problem");
  },

  // ---------- STUDENT / STARTUP PROJECT TABLES ----------

  getStudentProjects() {
    return JSON.parse(localStorage.getItem("jss_student_projects") || "[]");
  },

  getStartupCollabs() {
    return JSON.parse(localStorage.getItem("jss_startup_collabs") || "[]");
  },
};
