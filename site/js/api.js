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

/**
 * Where the Express API lives.
 *
 * `window.JSS_API_BASE_URL` is an optional override that can be written either
 * as the service root ("https://jharkhandsamadhansetu.onrender.com", "http://localhost:4000") or
 * with the "/api" suffix included ("https://jharkhandsamadhansetu.onrender.com/api"). Both
 * spellings are accepted, because the base is read from several places in this
 * codebase and a deployment should only ever have to set it once.
 *
 * When it isn't set: pages opened straight from disk (file://) or from a local
 * dev host talk to https://jharkhandsamadhansetu.onrender.com, and a deployed page calls the API on its
 * own origin ("/api/...").
 */
function resolveApiBase() {
  const override = String(window.JSS_API_BASE_URL || "").trim().replace(/\/+$/, "");
  if (override) return override.replace(/\/api$/i, "");

  const { protocol, hostname, port } = window.location;
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname);
  const staticPreviewPort = ["3000", "4173", "5500", "8000", "8080"].includes(port);
  if (protocol === "file:" || localHost || staticPreviewPort) {
    return `https://jharkhandsamadhansetu.onrender.com`;
  }
  return ""; // same origin -- apiUrl() adds the "/api" prefix
}

// localStorage/sessionStorage can hold junk (hand-edited, half-written, or
// written by an older version of this file). Never let a bad value take down
// the whole page script -- hand back the fallback instead.
function readJsonStorage(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn(`[api] ignoring unreadable "${key}":`, error.message);
    return fallback;
  }
}

const API = {

  // ---------- TRANSPORT ----------

  // Service root, without a trailing slash or the "/api" suffix.
  apiBase() {
    return resolveApiBase();
  },

  // Absolute (or same-origin) URL for an API path, e.g. apiUrl("/auth/send-email-otp").
  apiUrl(path) {
    const clean = String(path || "").startsWith("/") ? String(path) : `/${path || ""}`;
    return `${this.apiBase()}/api${clean}`;
  },

  /**
   * The single fetch wrapper every call in the app goes through, so the
   * API-base rules and the error messages only exist in one place.
   *
   * Fixes three real failure modes seen in this app:
   *  1. A wrong base URL returns a static host's 404 HTML -- response.json()
   *     used to throw "Unexpected token <" and the user saw a raw browser error.
   *  2. A dead API produced a bare "Failed to fetch".
   *  3. A hung request (e.g. an async route that threw before responding) left
   *     the button spinning forever, so now requests time out.
   */
  async request(path, { method = "GET", body, timeoutMs, headers = {} } = {}) {
    // 20s default; calls that ship large bodies (e.g. photo uploads) pass a
    // larger timeoutMs explicitly.
    timeoutMs = timeoutMs || (typeof FormData !== "undefined" && body instanceof FormData ? 120000 : 20000);
    const url = this.apiUrl(path);
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    let response;
    try {
      response = await fetch(
        url,
        {
          method,
          headers: {
            // For a FormData body the browser must set Content-Type itself: it
            // has to append the multipart boundary, and a forced
            // "application/json" header made the server see an empty upload.
            ...(isFormData ? {} : { "Content-Type": "application/json" }),
            ...this.authHeaders(),
            ...headers,
          },
          body: isFormData ? body : JSON.stringify(body),
          signal: controller?.signal,
        }
      );
    } catch (fetchError) {
      // Better error messages for common network issues
      if (controller) clearTimeout(timer);
      if (fetchError instanceof Error) {
        if (fetchError.name === "AbortError") {
          throw new Error(
            "सर्वर से जवाब नहीं मिला, कृपया पुनः प्रयास करें / Server did not respond, please try again"
          );
        }
        // Check if it's a connection refused / server not running error
        if (
          fetchError.message?.includes("fetch failed") ||
          fetchError.message?.includes("NetworkError") ||
          fetchError.message?.includes("ECONNREFUSED")
        ) {
          throw new Error(
            "सर्वर तक पहुँच नहीं मिली। क्या सर्वर चल रहा है? https://jharkhandsamadhansetu.onrender.com पर / Could not reach server. Is the server running at https://jharkhandsamadhansetu.onrender.com?"
          );
        }
      }
      throw new Error(
        "सर्वर से कनेक्शन विफल, कृपया पुनः प्रयास करें / Connection to server failed, please try again"
      );
    }

    if (!response.ok) {
      const where = this.apiBase() ? ` (${url})` : "";
      // The server always answers errors as { error: "..." } JSON, and that
      // message is the only thing that tells the citizen HOW to fix the
      // request (too big / wrong type / missing field). Parse it before the
      // generic fallback so the real reason reaches the toast.
      let serverMessage = "";
      try {
        const problem = await response.clone().json();
        if (problem && typeof problem.error === "string") serverMessage = problem.error;
      } catch {
        // non-JSON error body: fall through to the generic message
      }
      if (serverMessage) throw new Error(serverMessage);
      throw new Error(
        response.status === 429
          ? "बहुत अधिक अनुरोध, कृपया थोड़ी देर बाद प्रयास करें / Too many requests, please try again shortly"
          : `अनुरोध विफल रहा (HTTP ${response.status})${where} / Request failed (HTTP ${response.status})`
      );
    }

    // Read the body as text first so an HTML error page can't crash the parser.
    const rawBody = await response.text().catch(() => "");
    let data = {};
    if (rawBody) {
      try {
        data = JSON.parse(rawBody);
      } catch {
        data = {};
      }
    }

    return data;
  },

  // ---------- AUTH ----------

  // Fake login: accepts anything non-empty, stores a session.
  // Still used by the student/admin portals (there is no credentials backend
  // for those roles). The government and startup portals use
  // loginWithPassword() below, which stores a signed token alongside.
  // LATER: replace body with a real fetch('/api/auth/login', ...)
  login(role, identifier) {
    const session = { role, identifier, loggedInAt: new Date().toISOString() };
    try {
      localStorage.setItem("jss_session", JSON.stringify(session));
    } catch (error) {
      console.warn("[api] could not persist the session:", error.message);
    }
    return session;
  },

  // Stores the session returned by POST /api/accounts/login|register.
  setSession({ role, identifier, token, account }) {
    const session = {
      role: role || (account && account.role),
      identifier: identifier || (account && account.identifier),
      token,
      account: account || null,
      loggedInAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem("jss_session", JSON.stringify(session));
    } catch (error) {
      console.warn("[api] could not persist the session:", error.message);
    }
    return session;
  },

  // "Authorization: Bearer ..." for the routes that need a signed-in account.
  // Returns {} when the session has no token (citizen/student sessions), so
  // every existing call keeps working unchanged.
  authHeaders() {
    const session = this.getSession();
    return session && session.token ? { Authorization: `Bearer ${session.token}` } : {};
  },

  async loginWithPassword(role, identifier, password) {
    const result = await this.request("/accounts/login", {
      method: "POST",
      body: { role, identifier, password },
    });
    this.setSession({ role: result.account.role, identifier: result.account.identifier, token: result.token, account: result.account });
    return result.account;
  },

  async registerAccount(payload) {
    const result = await this.request("/accounts/register", { method: "POST", body: payload });
    this.setSession({
      role: result.account.role,
      identifier: result.account.identifier,
      token: result.token,
      account: result.account,
    });
    return result.account;
  },

  async refreshAccount() {
    const account = await this.request("/accounts/me");
    const session = this.getSession();
    if (session) this.setSession({ ...session, role: account.role, identifier: account.identifier, account });
    return account;
  },

  async getAccounts(role) {
    return this.request(`/accounts${role ? `?role=${encodeURIComponent(role)}` : ""}`);
  },

  // Update your own account details (name/designation/organisation/district/phone).
  async updateAccount(patch) {
    return this.request("/accounts/me", { method: "PATCH", body: patch });
  },

  logout() {
    localStorage.removeItem("jss_session");
  },

  getSession() {
    return readJsonStorage(localStorage, "jss_session", null);
  },

  // The signed-in account (null for the token-less citizen/student sessions).
  getAccount() {
    const session = this.getSession();
    return session && session.account ? session.account : null;
  },

  // Display name for the header pills: organisation, then name, then the id.
  getDisplayName() {
    const account = this.getAccount();
    if (account) return account.organisation || account.name || account.identifier;
    const session = this.getSession();
    return session ? session.identifier : "";
  },

  // ---------- PROBLEMS (Grievances) ----------

  getProblems() {
    return readJsonStorage(localStorage, "jss_problems", []);
  },

  getProblemById(id) {
    return this.getProblems().find(p => p.id === id);
  },

  async getProblemsFromServer(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const query = params.toString();
    return this.request(`/problems${query ? `?${query}` : ""}`);
  },

  // Student portal reads the same MongoDB grievances through the
  // student-safe projection (?audience=student): category, enriched
  // problemStatement, priority, dedup counts. Sorted by priorityScore so the
  // highest-priority citizen grievance is always on top.
  // Falls back to the 2-item curated localStorage set when the API is
  // unreachable (e.g. previewing the static site without `npm run dev`).
  async getStudentProblems(filters = {}) {
    try {
      return await this.getProblemsFromServer({ ...filters, audience: "student", sortBy: filters.sortBy || "priority" });
    } catch (error) {
      console.warn("[api] student list fell back to local curated challenges:", error.message);
      const local = this.getProblemsByPriority();
      const filtered = filters.category ? local.filter((p) => p.category === filters.category) : local;
      return filtered;
    }
  },

  async getStudentProblemById(id) {
    return this.request(`/problems/${encodeURIComponent(id)}?audience=student`);
  },

  // A student submits a solution to one grievance. problemId is the human
  // JH-* id; studentId defaults to the logged-in session identifier.
  async submitSolution(payload = {}) {
    const session = this.getSession ? this.getSession() : null;
    return this.request("/solutions", {
      method: "POST",
      body: { studentId: session && session.identifier, ...payload },
    });
  },

  async getSolutionsForProblem(problemId) {
    return this.request(`/solutions?problemId=${encodeURIComponent(problemId)}`);
  },

  async getProblemByIdFromServer(id) {
    return this.request(`/problems/${encodeURIComponent(id)}`);
  },

  async updateProblemStatus(id, status) {
    return this.request(`/problems/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: { status },
    });
  },

  // Called on the final grievance step. The server owns categorization,
  // ID generation, priority scoring, and persistence.
  async submitProblem(problem) {
    return this.request("/problems", { method: "POST", body: problem });
  },

  // Accepts a single file or an array. The server takes up to 5 files in the
  // "photos" field, so callers can hand over a multi-select list directly.
  async uploadEvidence(fileOrFiles) {
    const formData = new FormData();
    const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
    files.filter(Boolean).forEach((file) => formData.append("photos", file));

    // Photo evidence comes from phones on slow rural connections and the API
    // runs on a host with cold starts, so the generic 20s budget is too tight.
    // Give the multipart body a full 120 seconds.
    const result = await this.request("/upload/grievance-photos", { method: "POST", body: formData, timeoutMs: 120000 });
    return result.files || [];
  },

  // Placeholder categorizer - swap for real AI call later.
  fakeCategorize(text) {
    const t = text.toLowerCase();
    if (t.includes("water") || t.includes("pipeline") || t.includes("pani") || t.includes("jal") || t.includes("drinking")) return "Drinking Water & Sanitation";
    if (t.includes("electric") || t.includes("transformer") || t.includes("bijli") || t.includes("power") || t.includes("electricity")) return "Electricity & JBVNL";
    if (t.includes("hospital") || t.includes("ambulance") || t.includes("health") || t.includes("doctor") || t.includes("medical") || t.includes("phc")) return "Health & Family Welfare";
    if (t.includes("road") || t.includes("bridge") || t.includes("infrastructure") || t.includes("kutcha") || t.includes("pothole")) return "Roads & Infrastructure";
    if (t.includes("school") || t.includes("education") || t.includes("mid-day") || t.includes("midday") || t.includes("student") || t.includes("teacher") || t.includes("classroom")) return "Education";
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
    return readJsonStorage(sessionStorage, "jss_draft_problem", {});
  },

  clearDraft() {
    sessionStorage.removeItem("jss_draft_problem");
  },

  // Re-run the Grok/local enrichment on one grievance (government AI Analysis
  // page). Requires an officer token.
  async reanalyzeProblem(id) {
    return this.request(`/problems/${encodeURIComponent(id)}/reanalyze`, { method: "POST" });
  },

  // ---------- SOLUTIONS ----------

  // Any subset of { problemId, studentId, status }.
  async getSolutions(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const query = params.toString();
    return this.request(`/solutions${query ? `?${query}` : ""}`);
  },

  // Officer review step: Submitted | Under Review | Shortlisted | Rejected.
  async updateSolutionStatus(id, status) {
    return this.request(`/solutions/${encodeURIComponent(id)}/status`, { method: "PATCH", body: { status } });
  },

  // ---------- STATS ----------

  // Every number the government dashboards show (officer token required).
  async getOverviewStats() {
    return this.request("/stats/overview");
  },

  // Partner impact numbers. Officers may pass any partnerId; a partner always
  // gets its own, whatever it asks for (the server ignores the query param).
  async getImpactStats(partnerId) {
    return this.request(`/stats/impact${partnerId ? `?partnerId=${encodeURIComponent(partnerId)}` : ""}`);
  },

  // ---------- UNIVERSITIES / CSR ENTERPRISES ----------

  async getUniversities(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const query = params.toString();
    return this.request(`/universities${query ? `?${query}` : ""}`);
  },

  async updateUniversity(id, patch) {
    return this.request(`/universities/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });
  },

  async getEnterprises(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const query = params.toString();
    return this.request(`/enterprises${query ? `?${query}` : ""}`);
  },

  async updateEnterprise(id, patch) {
    return this.request(`/enterprises/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });
  },

  // ---------- STARTUP / ENTERPRISE PROFILES ----------

  async getStartupProfiles(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const query = params.toString();
    return this.request(`/startups${query ? `?${query}` : ""}`);
  },

  // Returns null (instead of throwing) when the signed-in partner has not
  // filled in a profile yet, so the Company Profile form can start empty.
  async getStartupProfile(identifier) {
    try {
      return await this.request(`/startups/${encodeURIComponent(identifier)}`);
    } catch (error) {
      if (/HTTP 404/.test(error.message)) return null;
      throw error;
    }
  },

  async saveStartupProfile(identifier, profile) {
    return this.request(`/startups/${encodeURIComponent(identifier)}`, { method: "PUT", body: profile });
  },

  async verifyStartupProfile(identifier, verified = true) {
    return this.request(`/startups/${encodeURIComponent(identifier)}/verify`, { method: "PATCH", body: { verified } });
  },

  // ---------- COLLABORATIONS ----------

  async getCollaborations(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const query = params.toString();
    return this.request(`/collaborations${query ? `?${query}` : ""}`);
  },

  async createCollaboration(payload) {
    return this.request("/collaborations", { method: "POST", body: payload });
  },

  async updateCollaborationStage(id, stage, fundingCommitted) {
    const body = { stage };
    if (fundingCommitted !== undefined && fundingCommitted !== null && fundingCommitted !== "") {
      body.fundingCommitted = fundingCommitted;
    }
    return this.request(`/collaborations/${encodeURIComponent(id)}/stage`, { method: "PATCH", body });
  },

  async addCollaborationMilestone(id, payload) {
    return this.request(`/collaborations/${encodeURIComponent(id)}/milestones`, { method: "POST", body: payload });
  },

  async updateCollaborationMilestone(id, milestoneId, patch) {
    return this.request(`/collaborations/${encodeURIComponent(id)}/milestones/${encodeURIComponent(milestoneId)}`, {
      method: "PATCH",
      body: patch,
    });
  },

  async addCollaborationMessage(id, body) {
    return this.request(`/collaborations/${encodeURIComponent(id)}/messages`, { method: "POST", body: { body } });
  },

  // ---------- STUDENT / STARTUP PROJECT TABLES ----------

  getStudentProjects() {
    return readJsonStorage(localStorage, "jss_student_projects", []);
  },

  getStartupCollabs() {
    return readJsonStorage(localStorage, "jss_startup_collabs", []);
  },
};
