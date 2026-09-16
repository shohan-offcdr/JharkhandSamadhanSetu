const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const uploadRoutes = require("./routes/upload");
const problemRoutes = require("./routes/problems");
const authRoutes = require("./routes/auth");
const citizenRoutes = require("./routes/citizens");

const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
const isProduction = process.env.NODE_ENV === "production";

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// In production only the explicit CORS_ORIGIN list is honoured. In local
// development (and for file:// pages, which send "Origin: null") the usual
// localhost spellings are allowed on any port: the site is often served by Live
// Server on 5500, by `python -m http.server` on 8000, by a preview on 3000.
// With a strict list, a blocked request reached the browser as nothing more
// helpful than "Failed to fetch" -- which is exactly the "OTP fetch failed"
// symptom this file used to cause.
function isAllowedOrigin(origin) {
  if (allowedOrigins.includes(origin)) return true;
  if (isProduction) return false;
  if (origin === "null") return true; // file:// pages
  try {
    const { protocol, hostname } = new URL(origin);
    const isHttp = protocol === "http:" || protocol === "https:";
    return isHttp && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header at all: server-to-server tools and same-origin calls.
      if (!origin || isAllowedOrigin(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
  })
);
const DB_STATES = ["disconnected", "connected", "connecting", "disconnecting"];
app.get("/api/health", (req, res) => {
  const db = DB_STATES[mongoose.connection.readyState] || "unknown";
  res.status(db === "connected" ? 200 : 503).json({
    status: "ok",
    service: "jss-server",
    db,
    time: new Date().toISOString(),
  });
});

app.get("/api/ready", (req, res) => {
  const checks = {
    database: mongoose.connection.readyState === 1,
    email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    storage: Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET),
  };
  const ready = Object.values(checks).every(Boolean);
  res.status(ready ? 200 : 503).json({ ready, checks });
});

// Rate limits are applied *after* the health checks on purpose: a load balancer
// polling /api/health every few seconds must not be able to rate-limit itself.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // express-rate-limit's default reply is plain text. The frontend parses JSON,
  // so a plain-text 429 showed up as a vague failure instead of the real reason.
  message: { error: "बहुत अधिक अनुरोध, कृपया थोड़ी देर बाद प्रयास करें / Too many requests, please try again shortly" },
});

// OTP endpoints send e-mail and accept guesses, so they get a tighter budget
// than the rest of the API.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "बहुत अधिक OTP अनुरोध, कृपया कुछ मिनट बाद प्रयास करें / Too many OTP requests, please try again in a few minutes" },
});

app.use(globalLimiter);

app.use("/api/upload", uploadRoutes);
app.use("/api/problems", problemRoutes);
app.use("/api/auth", otpLimiter, authRoutes);
app.use("/api/citizens", citizenRoutes);

// 404 for unmatched API routes
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Every error path in the app ends up here, and always as JSON: the frontend
// parses error responses, so an HTML error page would surface as a meaningless
// failure instead of the actual reason.
app.use((err, req, res, next) => {
  if (!err) return next();

  // CORS rejections raised by the middleware above.
  if (/not allowed by CORS/.test(err.message || "")) {
    console.warn("[cors]", err.message);
    return res.status(403).json({
      error:
        "यह वेबसाइट इस API से जुड़ने की अनुमति नहीं रखती / This site is not allowed to call the API. " +
        "Add its origin to CORS_ORIGIN in server/.env.",
    });
  }

  // Malformed JSON body (thrown by express.json).
  if (err.type === "entity.parse.failed" || (err.name === "SyntaxError" && err.status === 400)) {
    return res.status(400).json({ error: "अनुरोध का प्रारूप गलत है / Malformed JSON request body" });
  }

  // Multer: file too large, too many files, or the wrong file type.
  if (err.name === "MulterError") {
    const message = err.code === "LIMIT_FILE_SIZE"
      ? "फोटो 5MB से छोटी होनी चाहिए / Each photo must be under 5MB"
      : `फोटो अपलोड विफल रहा (${err.code}) / Photo upload failed (${err.code})`;
    return res.status(400).json({ error: message });
  }
  if (/Only JPG|केवल JPG/.test(err.message || "")) {
    return res.status(400).json({ error: err.message });
  }

  // A Mongoose validation/cast failure means the payload was wrong, not that the
  // server broke -- those used to be reported as a 500.
  if (err.name === "ValidationError" || err.name === "CastError") {
    console.warn("[api] rejected invalid payload:", err.message);
    return res.status(400).json({ error: "भेजी गई जानकारी मान्य नहीं है / The submitted data is not valid" });
  }

  // Include the route in the log: the per-route try/catch blocks that used to
  // print their own context are gone now that this handler always answers.
  console.error(`[api] ${req.method} ${req.originalUrl} failed:`, err);

  const status = err.status >= 400 ? err.status : 500;
  // 4xx messages are written for the caller; a 5xx message is written for us,
  // so it must never be echoed back to the browser.
  res.status(status).json({
    error: status >= 500 ? "सर्वर त्रुटि, कृपया पुनः प्रयास करें / Server error, please try again" : err.message || "Request failed",
  });
});

module.exports = app;
