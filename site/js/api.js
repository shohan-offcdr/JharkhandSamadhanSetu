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
 * as the service root ("https://api.example.com", "http://localhost:4000") or
 * with the "/api" suffix included ("https://api.example.com/api"). Both
 * spellings are accepted, because the base is read from several places in this
 * codebase and a deployment should only ever have to set it once.
 *
 * When it isn't set: pages opened straight from disk (file://) or from a local
 * dev host talk to http://<host>:4000, and a deployed page calls the API on its
 * own origin ("/api/...").
 */
function resolveApiBase() {
  const override = String(window.JSS_API_BASE_URL || "").trim().replace(/\/+$/, "");
  if (override) return override.replace(/\/api$/i, "");

  const { protocol, hostname } = window.location;
  if (protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname)) {
    return `http://${hostname || "localhost"}:4000`;
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
  async request(path, { method = "GET", body, timeoutMs = 20000, headers = {} } = {}) {
    const url = this.apiUrl(path);
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    let response;
    try {
      response = await fetch(url, {
        method,
        // Never set Content-Type for FormData -- the browser must add its own
        // multipart boundary, otherwise Multer rejects the upload.
        headers: isFormData || body === undefined ? headers : { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : (isFormData ? body : JSON.stringify(body)),
        signal: controller ? controller.signal : undefined,
      });
    } catch (error) {
      const where = this.apiBase() ? ` (${url})` : "";
      throw new Error(
        error && error.name === "AbortError"
          ? `सर्वर से समय पर उत्तर नहीं मिला${where} / The server took too long to respond`
          : `सर्वर से संपर्क नहीं हो सका${where}। कृपया जांचें कि API चालू है। / Could not reach the server${where}. Check that the API is running.`
      );
    } finally {
      if (timer) clearTimeout(timer);
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

    if (!response.ok) {
      const fallback = response.status === 429
        ? "बहुत अधिक अनुरोध, कृपया थोड़ी देर बाद प्रयास करें / Too many requests, please try again shortly"
        : `अनुरोध विफल रहा (HTTP ${response.status}) / Request failed (HTTP ${response.status})`;
      const requestError = new Error(data.error || fallback);
      requestError.status = response.status;
      requestError.data = data;
      throw requestError;
    }

    return data;
  },

  // ---------- AUTH ----------

  // Fake login: accepts anything non-empty, stores a session.
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

  logout() {
    localStorage.removeItem("jss_session");
  },

  getSession() {
    return readJsonStorage(localStorage, "jss_session", null);
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

    const result = await this.request("/upload/grievance-photos", { method: "POST", body: formData });
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

  // ---------- STUDENT / STARTUP PROJECT TABLES ----------

  getStudentProjects() {
    return readJsonStorage(localStorage, "jss_student_projects", []);
  },

  getStartupCollabs() {
    return readJsonStorage(localStorage, "jss_startup_collabs", []);
  },
};
