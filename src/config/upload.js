import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const UPLOAD_DIR = process.env.UPLOADS_PATH
  || path.resolve(process.cwd(), process.env.NODE_ENV === "production" ? "uploads" : "uploads/dev");

export const ASSET_TYPES = {
  profile: {
    key: "profile",
    maxWidth: 400,
    maxHeight: 400,
    maxSize: 2 * 1024 * 1024,
    allowedFormats: ["jpg", "jpeg", "png", "webp", "bmp"],
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/bmp"],
    outputFormat: "webp",
    outputQuality: 85,
  },
  logo: {
    key: "logo",
    maxWidth: 256,
    maxHeight: 256,
    maxSize: 2 * 1024 * 1024,
    allowedFormats: ["jpg", "jpeg", "png", "webp", "svg"],
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
    outputFormat: "webp",
    outputQuality: 85,
  },
  banner: {
    key: "banner",
    maxWidth: 1200,
    maxHeight: 400,
    maxSize: 5 * 1024 * 1024,
    allowedFormats: ["jpg", "jpeg", "png", "webp"],
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    outputFormat: "webp",
    outputQuality: 85,
  },
};

export const MAGIC_BYTES = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47],
  webp: [0x52, 0x49, 0x46, 0x46],
  bmp: [0x42, 0x4d],
  svg: [0x3c, 0x73, 0x76, 0x67],
};
