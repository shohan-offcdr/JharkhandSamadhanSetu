const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const uploadRoutes = require("./routes/upload");
const problemRoutes = require("./routes/problems");
const authRoutes = require("./routes/auth");
const citizenRoutes = require("./routes/citizens");

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow tools with no Origin header (curl, Postman) and any explicitly listed origin.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
  })
);
app.use(express.json());

const DB_STATES = ["disconnected", "connected", "connecting", "disconnecting"];
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "jss-server",
    db: DB_STATES[mongoose.connection.readyState] || "unknown",
    time: new Date().toISOString(),
  });
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
