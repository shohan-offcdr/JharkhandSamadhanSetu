const express = require("express");
const cloudinary = require("../config/cloudinary");
const upload = require("../middleware/upload");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

function streamToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    uploadStream.end(buffer);
  });
}

const CLOUDINARY_OPTIONS = {
  folder: "jss/grievance-evidence",
  resource_type: "image",
  // Keeps storage/bandwidth predictable — grievance photos don't need to be huge.
  transformation: [{ width: 1600, height: 1600, crop: "limit" }, { quality: "auto:good" }],
};

// POST /api/upload/grievance-photos  (field name: "photos", up to 5 files)
// Used by the citizen grievance form's photo-evidence step.
router.post(
  "/grievance-photos",
  upload.array("photos", 5),
  asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "कम से कम एक फोटो चुनें / Select at least one photo" });
    }

    try {
      const results = await Promise.all(
        req.files.map((file) => streamToCloudinary(file.buffer, CLOUDINARY_OPTIONS))
      );
      const uploaded = results.map((r) => ({
        url: r.secure_url,
        publicId: r.public_id,
        width: r.width,
        height: r.height,
        bytes: r.bytes,
      }));
      return res.status(201).json({ files: uploaded });
    } catch (err) {
      // 502: the API itself is fine, the storage provider is the part that failed.
      console.error("[upload] Cloudinary upload failed:", err.message);
      return res.status(502).json({ error: "फोटो अपलोड विफल रहा, कृपया पुनः प्रयास करें / Photo upload failed, please try again" });
    }
  })
);

// DELETE /api/upload/:publicId  — lets a citizen remove a photo before final submission.
// publicId contains slashes (folder/name), so it's passed as a query param, not a route param.
router.delete(
  "/",
  asyncHandler(async (req, res) => {
    const { publicId } = req.query;
    if (!publicId) {
      return res.status(400).json({ error: "publicId आवश्यक है / publicId is required" });
    }
    const result = await cloudinary.uploader.destroy(String(publicId), { resource_type: "image" });
    // Cloudinary answers { result: "not found" } for an unknown id. Reporting that
    // as success made the UI claim a photo had been removed when nothing happened.
    if (result.result === "not found") {
      return res.status(404).json({ error: "फोटो नहीं मिली / Photo not found" });
    }
    res.json({ result: result.result });
  })
);

module.exports = router;
