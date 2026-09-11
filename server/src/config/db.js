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

  connectPromise = mongoose.connect(uri);
  return connectPromise;
}

module.exports = connectDB;
