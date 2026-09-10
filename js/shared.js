/**
 * shared.js
 * Small helpers used across multiple pages.
 * Loaded after mock-data.js and api.js on every page.
 */

// Redirect to a role's login page if no session exists for that role.
// Call this at the top of any dashboard/protected page:
//   requireRole('student', '../student/login.html');
function requireRole(role, loginPageRelPath) {
  const session = API.getSession();
  if (!session || session.role !== role) {
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
