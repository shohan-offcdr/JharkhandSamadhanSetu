/**
 * api.js
 * ---------------------------------------------------------
 * This is your "backend" abstraction layer.
 *
 * Read/write helpers for the citizen portal. Grievance submissions go to
 * the Express API so they are persisted in MongoDB; draft form state remains
 * in sessionStorage until the final step.
 * ---------------------------------------------------------
 */

const API_BASE_URL = window.JSS_API_BASE_URL || (
  window.location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? `http://${window.location.hostname || 'localhost'}:4000/api`
    : '/api'
);

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

  // Called on the final grievance step. The server owns categorization,
  // ID generation, priority scoring, and persistence.
  async submitProblem(problem) {
    let response;
    try {
      response = await fetch(`${API_BASE_URL}/problems`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(problem),
      });
    } catch (error) {
      throw new Error("सर्वर से संपर्क नहीं हो सका / Could not reach the grievance server");
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || "शिकायत दर्ज नहीं हो सकी / Could not submit grievance");
    }
    return result;
  },

  async uploadEvidence(file) {
    const formData = new FormData();
    formData.append("photos", file);

    let response;
    try {
      response = await fetch(`${API_BASE_URL}/upload/grievance-photos`, {
        method: "POST",
        body: formData,
      });
    } catch (error) {
      throw new Error("फोटो सर्वर तक नहीं पहुंच सकी / Could not reach the photo server");
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || "फोटो अपलोड विफल रहा / Photo upload failed");
    }
    return result.files || [];
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
