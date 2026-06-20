import path from "path";
import fs from "fs";
import sharp from "sharp";
import { UPLOAD_DIR, ASSET_TYPES, MAGIC_BYTES } from "../config/upload.js";

export function getUploadDir() {
  return UPLOAD_DIR;
}

export function deleteFileByUrl(url) {
  if (!url) return false;
  let relativePath;
  try {
    const parsed = new URL(url);
    relativePath = parsed.pathname.replace(/^\/uploads\//, "");
  } catch {
    relativePath = url.replace(/^\/uploads\//, "");
  }
  const filePath = path.join(UPLOAD_DIR, relativePath);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch {}
  return false;
}

export function buildFileUrl(filename, userId, assetType) {
  const base = process.env.UPLOADS_BASE_URL || "";
  const urlPath = `/uploads/${userId}/${assetType}/${filename}`;
  return base
    ? `${base.replace(/\/+$/, "")}${urlPath}`
    : urlPath;
}

export function validateMagicBytes(filePath, assetType) {
  const config = ASSET_TYPES[assetType];
  if (!config) throw new Error(`Unknown asset type: ${assetType}`);

  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const expectedSig = MAGIC_BYTES[ext];
  if (!expectedSig) return;

  const buf = Buffer.alloc(8);
  const fd = fs.openSync(filePath, "r");
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);

  const matches = expectedSig.every((byte, i) => buf[i] === byte);
  if (!matches) {
    try { fs.unlinkSync(filePath); } catch {}
    throw new Error(`Invalid ${ext} file — magic byte mismatch`);
  }
}

export async function processImage(filePath, assetType) {
  const config = ASSET_TYPES[assetType];
  if (!config) throw new Error(`Unknown asset type: ${assetType}`);

  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".svg") {
    return path.basename(filePath);
  }

  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, ext);
  const outputPath = path.join(dir, `${baseName}.${config.outputFormat}`);

  await sharp(filePath)
    .resize(config.maxWidth, config.maxHeight, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: config.outputQuality })
    .toFile(outputPath);

  try { fs.unlinkSync(filePath); } catch {}

  return `${baseName}.${config.outputFormat}`;
}

export function generateInitialsSvg(name, size = 200) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

  const hash = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const hue = hash % 360;
  const bgColor = `hsl(${hue}, 50%, 55%)`;
  const fontSize = Math.round(size * 0.4);
  const radius = Math.round(size * 0.5);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <circle cx="${radius}" cy="${radius}" r="${radius}" fill="${bgColor}"/>
  <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle"
    font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}"
    font-weight="600" fill="white">${initials}</text>
</svg>`;
}

export function assetUrl(req, relativePath) {
  if (!relativePath) return relativePath;
  if (relativePath.startsWith("http")) return relativePath;
  const proto = req.headers?.["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers?.["x-forwarded-host"] || req.headers?.host;
  return host ? `${proto}://${host}${relativePath}` : relativePath;
}

export function enrichUserAssets(req, user) {
  const obj = typeof user?.toJSON === "function" ? user.toJSON() : { ...user };
  if (obj.profilePicture) {
    obj.profilePicture = assetUrl(req, obj.profilePicture);
  } else {
    const name = obj.fullName || "User";
    obj.profilePicture = assetUrl(
      req,
      `/api/assets/avatar?name=${encodeURIComponent(name)}&size=200`,
    );
  }
  return obj;
}

export function enrichStorefrontAssets(req, sf) {
  const obj = typeof sf?.toJSON === "function" ? sf.toJSON() : { ...sf };
  if (obj.branding) {
    if (obj.branding.logoUrl) obj.branding.logoUrl = assetUrl(req, obj.branding.logoUrl);
    if (obj.branding.bannerUrl) obj.branding.bannerUrl = assetUrl(req, obj.branding.bannerUrl);
  }
  return obj;
}
