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
// One-time-password helpers shared by the citizen login/register pages.
// These used to be copy-pasted into both pages, which is how the "Get OTP"
// button ended up with two slightly different (and both broken) behaviours.
// ---------------------------------------------------------------

let countdownInterval = null;

// The only code that works when Firebase SMS isn't available. When this is
// used, the page says so out loud instead of claiming an SMS was sent.
const DEMO_MOBILE_OTP = "252525";

const MobileOtp = {
  // True once Firebase actually accepted the send for the current code.
  sentViaFirebase: false,

  // firebase-config.js loads as a deferred ES module, so it can finish after
  // the click handler exists. Wait briefly for it instead of racing it.
  async firebase(timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (window.__firebaseAuth) return window.__firebaseAuth;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  },

  // Sends a real SMS OTP via Firebase when it's available, and falls back to
  // demo mode when it isn't (e.g. the Blaze plan isn't enabled yet) so the
  // demo never dead-ends. Returns { channel, message } for the page to toast.
  async send(tenDigitNumber) {
    const firebase = await this.firebase();
    if (firebase) {
      try {
        await firebase.sendOtp(tenDigitNumber);
        this.sentViaFirebase = true;
        return {
          channel: "firebase",
          message: `OTP भेजा गया +91 ${tenDigitNumber} पर / OTP sent to +91 ${tenDigitNumber}`,
        };
      } catch (error) {
        // Surface *why* the SMS didn't go out (Blaze plan, quota, unauthorised
        // domain, ...) instead of quietly pretending a demo code is the whole
        // story -- that reason is the first thing anyone debugging this needs.
        console.warn("[otp] Firebase SMS unavailable, using demo mode:", error.message);
        this.sentViaFirebase = false;
        return {
          channel: "demo",
          message: `${error.message} | डेमो OTP: ${DEMO_MOBILE_OTP} / Demo OTP: ${DEMO_MOBILE_OTP}`,
        };
      }
    }

    this.sentViaFirebase = false;
    return {
      channel: "demo",
      message: `डेमो मोड (SMS सेवा उपलब्ध नहीं): OTP ${DEMO_MOBILE_OTP} / Demo mode (SMS unavailable): OTP ${DEMO_MOBILE_OTP}`,
    };
  },

  // Verifies the typed code against whichever channel actually sent it.
  // Throws a user-facing Error; resolves with the verified mobile number.
  async verify(code, tenDigitNumber) {
    const trimmed = String(code || "").trim();
    if (this.sentViaFirebase) {
      const firebase = await this.firebase();
      if (firebase) {
        await firebase.verifyOtp(trimmed);
        return tenDigitNumber;
      }
    }
    if (trimmed !== DEMO_MOBILE_OTP) {
      throw new Error("गलत OTP / Incorrect OTP");
    }
    return tenDigitNumber;
  },

  reset() {
    this.sentViaFirebase = false;
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
