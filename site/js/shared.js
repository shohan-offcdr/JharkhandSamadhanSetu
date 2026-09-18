/**
 * shared.js
 * Small helpers used across multiple pages.
 * Loaded after mock-data.js and api.js on every page.
 */

// Redirect to a role's login page if no session exists for any of the roles.
// Accepts one role or an array of them: a page such as student/problem-view.html
// is reachable from the startup portal too, so it has to allow both roles.
// Call this at the top of any dashboard/protected page:
//   requireRole('student', '../student/login.html');
//   requireRole(['student', 'startup'], 'login.html');
function requireRole(roleOrRoles, loginPageRelPath) {
  const allowed = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
  const session = API.getSession();
  if (!session || !allowed.includes(session.role)) {
    window.location.href = loginPageRelPath;
    return;
  }

  // The government and startup portals read their data from token-protected API
  // routes. A session left over from the old password-less login has no token,
  // so every request on the page would fail with 401 -- send the officer/partner
  // back through the login form instead of rendering a page full of errors.
  const tokenRoles = ["government", "startup"];
  if (tokenRoles.includes(session.role) && !session.token) {
    window.location.href = loginPageRelPath;
  }
}

// Wire up any element with [data-logout] to clear session and go home.
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-logout]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      API.logout();
      const homePath = el.getAttribute("data-logout") || "../index.html";
      window.location.href = homePath;
    });
  });

  // Fill any element with [data-session-name] with the logged in identifier
  const session = API.getSession();
  if (session) {
    document.querySelectorAll("[data-session-name]").forEach(el => {
      el.textContent = session.identifier;
    });
  }

  // Explicit "coming soon" placeholders (e.g. legal pages we haven't written yet).
  // Give them a real, honest response instead of a dead href="#".
  document.querySelectorAll("[data-coming-soon]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      showToast(el.dataset.comingSoon || "यह सुविधा जल्द जुड़ेगी / Coming soon");
    });
  });

  // Safety net: any link still pointing at a bare "#" (i.e. not yet wired to a
  // real action) gets an honest toast instead of silently doing nothing.
  // Anything with its own click handler already calls preventDefault() first,
  // so this only ever fires for genuinely-unwired links.
  document.querySelectorAll('a[href="#"]:not([data-coming-soon])').forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      showToast("यह सुविधा अभी इस डेमो में जुड़ी नहीं है / Not wired up in this demo yet");
    });
  });
});

// Tiny toast so form actions have visible feedback without alert().
function showToast(message) {
  let toast = document.getElementById("jss-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "jss-toast";
    toast.style.position = "fixed";
    toast.style.bottom = "88px";
    toast.style.left = "50%";
    toast.style.transform = "translateX(-50%)";
    toast.style.background = "#17213A";
    toast.style.color = "#fff";
    toast.style.padding = "10px 20px";
    toast.style.borderRadius = "8px";
    toast.style.fontSize = "14px";
    toast.style.zIndex = "9999";
    toast.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";
    toast.style.transition = "opacity 0.3s ease";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = "1";
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => { toast.style.opacity = "0"; }, 2200);
}

// ---------------------------------------------------------------
// Shared render helpers for the API-backed (live) pages.
//
// Every government/startup page renders values that came from Mongo, so they
// all need the same escaping, money/date formatting and loading/error states.
// They live here instead of being copied into each page.
// ---------------------------------------------------------------

// Escapes a value before it is interpolated into an innerHTML template.
function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char])
  );
}

// 1250000 -> "₹12.5 L", 12000000 -> "₹1.20 Cr", 9500 -> "₹9,500".
function formatInr(amount) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value) || value <= 0) return "₹0";
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)} L`;
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

// "2024-06-10" / ISO timestamps -> "10 Jun 2024". Falls back to the raw string
// so an unusual value (e.g. "Q3 2026") is shown rather than swallowed.
function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Puts an honest loading/error/empty message inside a container, instead of
// leaving the previous (or hardcoded) content on screen.
function setPanelState(element, message, tone = "muted") {
  if (!element) return;
  const toneClass =
    tone === "error" ? "text-error" : tone === "success" ? "text-[#166534]" : "text-on-surface-variant";
  element.innerHTML = `<p class="p-6 text-center ${toneClass}">${escapeHtml(message)}</p>`;
}

// A consistent header for a table body that has nothing to show yet.
function emptyTableRow(colSpan, message) {
  return `<tr><td colspan="${Number(colSpan) || 1}" class="p-6 text-center text-on-surface-variant">${escapeHtml(message)}</td></tr>`;
}

// ---------------------------------------------------------------
// One-time-password helpers shared by the citizen login/register pages.
// These used to be copy-pasted into both pages, which is how the "Get OTP"
// button ended up with two slightly different (and both broken) behaviours.
// ---------------------------------------------------------------

let countdownInterval = null;
const DEMO_MOBILE_OTP = "252525";

const MobileOtp = {
  sent: false,

  // Resend delivers email, not SMS. Phone login is therefore an explicit
  // local prototype flow and never makes a Firebase or API request.
  async send() {
    // Store OTP securely in session for verification
    if (window.sessionStorage) {
      window.sessionStorage.setItem('jss_mobile_otp', DEMO_MOBILE_OTP);
    }
    this.sent = true;
    return {
      channel: "demo",
      message: "OTP आपके मोबाइल पर भेजा गया है / OTP sent to your mobile",
    };
  },

  async verify(code, tenDigitNumber) {
    const trimmed = String(code || "").trim();
    if (!this.sent) {
      // Fallback: check sessionStorage in case sent flag was lost
      const storedOtp = window.sessionStorage?.getItem('jss_mobile_otp');
      if (!storedOtp || trimmed !== storedOtp) {
        throw new Error("पहले OTP भेजें / Send an OTP first");
      }
    } else {
      if (trimmed !== DEMO_MOBILE_OTP) throw new Error("गलत OTP / Incorrect OTP");
    }
    this.sent = false;
    if (window.sessionStorage) {
      window.sessionStorage.removeItem('jss_mobile_otp');
    }
    return tenDigitNumber;
  },

  reset() {
    this.sent = false;
  },
};

// Locks the "Get OTP" button for a minute after a code is requested, then
// restores it. It owns the button state itself, so a failed request can't
// leave the button stuck (the old copy in the pages only ever re-enabled the
// button from some of its call sites).
function startOtpCountdown(seconds = 59) {
  const btn = document.getElementById("getOtpBtn");
  const timerSpan = document.getElementById("otpTimer");
  const countdownEl = document.getElementById("countdown");
  if (!btn || !timerSpan || !countdownEl) return;

  const setRemaining = (value) => {
    countdownEl.innerText = `00:${value < 10 ? "0" : ""}${value}`;
  };

  btn.disabled = true;
  btn.classList.add("opacity-50", "no-underline", "cursor-not-allowed");
  timerSpan.classList.remove("hidden");
  timerSpan.classList.add("flex");

  let timeLeft = seconds;
  setRemaining(timeLeft);

  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    timeLeft -= 1;
    if (timeLeft <= 0) {
      clearInterval(countdownInterval);
      btn.disabled = false;
      btn.classList.remove("opacity-50", "no-underline", "cursor-not-allowed");
      timerSpan.classList.add("hidden");
      timerSpan.classList.remove("flex");
      btn.innerText = "Resend OTP / पुनः भेजें";
      setRemaining(0);
      MobileOtp.reset();
    } else {
      setRemaining(timeLeft);
    }
  }, 1000);
}

// Releases the lock immediately -- used when a send fails, so the citizen can
// correct their email/number and try again without waiting out the timer.
function stopOtpCountdown() {
  clearInterval(countdownInterval);
  const btn = document.getElementById("getOtpBtn");
  const timerSpan = document.getElementById("otpTimer");
  if (btn) {
    btn.disabled = false;
    btn.classList.remove("opacity-50", "no-underline", "cursor-not-allowed");
  }
  if (timerSpan) {
    timerSpan.classList.add("hidden");
    timerSpan.classList.remove("flex");
  }
}
