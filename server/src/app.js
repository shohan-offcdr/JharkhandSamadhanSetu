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
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false }));

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow tools with no Origin header, local file pages during development,
      // and any explicitly listed origin.
      if (!origin || (origin === "null" && process.env.NODE_ENV !== "production") || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
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

app.use("/api/upload", uploadRoutes);
app.use("/api/problems", problemRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/citizens", citizenRoutes);

// 404 for unmatched API routes
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Multer errors (file too large, wrong type, etc.) land here.
app.use((err, req, res, next) => {
  if (err) {
    const status = err.name === "MulterError" || /Only JPG|केवल/.test(err.message) ? 400 : 500;
    return res.status(status).json({ error: err.message || "Server error" });
  }
  next();
});

module.exports = app;
