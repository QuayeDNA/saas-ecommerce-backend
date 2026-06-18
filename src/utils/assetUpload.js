import path from "path";
import fs from "fs";

const UPLOAD_DIR = process.env.UPLOADS_PATH
  || path.resolve(process.cwd(), process.env.NODE_ENV === "production" ? "uploads" : "uploads/dev");

export function getUploadDir() {
  return UPLOAD_DIR;
}

export function deleteFileByUrl(url) {
  if (!url) return false;
  const relativePath = url.replace(/^\/uploads\//, "");
  const filePath = path.join(UPLOAD_DIR, relativePath);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch {
    // Ignore — file may already be gone
  }
  return false;
}

export function buildFileUrl(filename, userId) {
  const base = process.env.UPLOADS_BASE_URL || "";
  return base
    ? `${base.replace(/\/+$/, "")}/uploads/${userId}/${filename}`
    : `/uploads/${userId}/${filename}`;
}
