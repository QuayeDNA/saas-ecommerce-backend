import { Readable } from "stream";
import cloudinary, { ASSET_TYPES } from "../config/upload.js";

export function getPublicIdFromUrl(url) {
  if (!url) return null;
  try {
    const parts = url.split("/");
    const uploadIndex = parts.indexOf("upload");
    if (uploadIndex === -1) return null;
    const versionIndex = uploadIndex + 2;
    const folderParts = parts.slice(uploadIndex + 2, -1);
    const fileWithExt = parts[parts.length - 1];
    const fileName = fileWithExt.replace(/\.[^.]+$/, "");
    return [...folderParts, fileName].join("/");
  } catch {
    return null;
  }
}

export async function uploadToCloudinary(file, userId, assetType) {
  const config = ASSET_TYPES[assetType];
  if (!config) throw new Error(`Unknown asset type: ${assetType}`);

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `${userId}/${config.folder}`,
        resource_type: "image",
        allowed_formats: config.allowedFormats,
        transformation: [
          {
            width: config.maxWidth,
            height: config.maxHeight,
            crop: "fit",
            without_enlargement: true,
          },
          { quality: "auto", fetch_format: "auto" },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      },
    );

    const readable = new Readable();
    readable.push(file.buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
}

export async function deleteFromCloudinary(url) {
  const publicId = getPublicIdFromUrl(url);
  if (!publicId) return false;
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result.result === "ok";
  } catch {
    return false;
  }
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
