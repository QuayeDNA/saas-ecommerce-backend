import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { UPLOAD_DIR, ASSET_TYPES } from "../config/upload.js";

const instances = {};

function createUpload(assetTypeKey) {
  const config = ASSET_TYPES[assetTypeKey];
  if (!config) throw new Error(`Unknown asset type: ${assetTypeKey}`);

  const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
      const userId = req.user?.userId || "anonymous";
      const dir = path.join(UPLOAD_DIR, userId, config.key);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${randomUUID()}${ext}`);
    },
  });

  const fileFilter = (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
    if (!config.allowedFormats.includes(ext)) {
      return cb(new Error(`Invalid file type. Allowed: ${config.allowedFormats.join(", ")}`));
    }
    if (!config.mimeTypes.includes(file.mimetype)) {
      return cb(new Error(`Invalid MIME type: ${file.mimetype}`));
    }
    cb(null, true);
  };

  return multer({ storage, fileFilter, limits: { fileSize: config.maxSize } }).single("file");
}

export function handleUpload(assetTypeKey) {
  return (req, res, next) => {
    const middleware = instances[assetTypeKey] || (instances[assetTypeKey] = createUpload(assetTypeKey));
    middleware(req, res, (err) => {
      if (err) {
        const msg = err instanceof multer.MulterError
          ? `Upload error: ${err.message}`
          : err.message || "Upload failed";
        return res.status(400).json({ success: false, message: msg });
      }
      next();
    });
  };
}
