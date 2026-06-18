import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { authenticate } from "../middlewares/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ── Multer config ────────────────────────────────────────────────────────────
const UPLOAD_DIR = process.env.UPLOADS_PATH
  || path.resolve(process.env.NODE_ENV === "production" ? "/uploads" : "/uploads/dev");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const userId = req.user?.userId || "anonymous";
    const userDir = path.join(UPLOAD_DIR, userId);
    fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${unique}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp|svg/;
  const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
  const mimeOk = allowed.test(file.mimetype.split("/").pop());
  if (extOk && mimeOk) {
    cb(null, true);
  } else {
    cb(new Error("Only image files (jpg, png, gif, webp, svg) are allowed"));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

/**
 * POST /api/upload/image
 * Accepts a single file under field name "file".
 * Returns { url } — the public path to the uploaded image.
 */
router.post(
  "/image",
  authenticate,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        const msg = err instanceof multer.MulterError
          ? `Upload error: ${err.message}`
          : err.message || "Upload failed";
        return res.status(400).json({ success: false, message: msg });
      }
      next();
    });
  },
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file provided" });
    }
    const userId = req.user?.userId || "anonymous";
    const base = process.env.UPLOADS_BASE_URL || "";
    const url = base
      ? `${base.replace(/\/+$/, "")}/uploads/${userId}/${req.file.filename}`
      : `/uploads/${userId}/${req.file.filename}`;
    res.json({ success: true, url });
  },
);

export default router;
