require("dotenv").config();

const requiredEnvironment = ["MONGODB_URI", "RESEND_API_KEY", "EMAIL_FROM", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
if (missingEnvironment.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvironment.join(", ")}`);
}
if (process.env.NODE_ENV === "production" && !process.env.CORS_ORIGIN) {
  throw new Error("CORS_ORIGIN is required in production");
}

const app = require("./app");
const connectDB = require("./config/db");
const mongoose = require("mongoose");

const PORT = process.env.PORT || 4000;

connectDB()
  .then(() => {
    let server;
    let shuttingDown = false;

    const closeServer = () => new Promise((resolve) => {
      if (!server || !server.listening) return resolve();
      server.close(() => resolve());
    });

    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[server] ${signal} received, shutting down`);
      await closeServer();
      await mongoose.connection.close();
      process.exit(0);
    };

    server = app.listen(PORT, () => {
      console.log(`jss-server listening on http://localhost:${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
    });

    // Build/verify indexes explicitly. Mongoose does this automatically, but an
    // index/schema mismatch (for example an older non-unique index blocking a
    // new unique one) would surface as an unhandled rejection and take the
    // process down. Here it is logged clearly and traffic keeps being served.
    const models = [
      require("./models/Problem"),
      require("./models/Citizen"),
      require("./models/EmailOtp"),
      require("./models/Solution"),
      require("./models/Account"),
      require("./models/University"),
      require("./models/EnterpriseCsr"),
      require("./models/StartupProfile"),
      require("./models/Collaboration"),
    ];
    Promise.all(
      models.map((model) =>
        model.init().catch((err) => {
          console.warn(`[db] index warning for ${model.modelName}: ${err.message}`);
        })
      )
    ).then(() => console.log("[db] indexes verified"));

    // Recover any pending AI analyses from before a server restart.
    // Without this, problems submitted before a crash/restarte stay "pending" forever.
    const { recoverPendingAnalyses } = require("./services/analysisQueue");
    recoverPendingAnalyses({ limit: 50 })
      .then((count) => {
        if (count > 0) {
          console.log(`[analysis-queue] recovered ${count} pending analysis job(s) on boot`);
        }
      })
      .catch((err) => console.error("[analysis-queue] recovery failed:", err.message));
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`[server] Port ${PORT} is already in use. Stop the existing server before starting another one.`);
        process.exit(1);
      }
      throw err;
    });

    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
  })
  .catch((err) => {
    console.error("[server] failed to connect to MongoDB, not starting:", err.message);
    process.exit(1);
  });
