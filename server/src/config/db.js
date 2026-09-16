const mongoose = require("mongoose");

let connectPromise = null;

function connectDB() {
  if (connectPromise) return connectPromise;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set. Check server/.env.");
  }

  mongoose.connection.on("connected", () => {
    console.log("[db] connected to MongoDB Atlas");
  });
  mongoose.connection.on("error", (err) => {
    console.error("[db] connection error:", err.message);
  });

  // Fail fast instead of buffering commands forever when Atlas is unreachable or
  // the current IP isn't on the Atlas network access list -- before this, a
  // misconfigured deployment just hung every request.
  connectPromise = mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  return connectPromise;
}

module.exports = connectDB;
