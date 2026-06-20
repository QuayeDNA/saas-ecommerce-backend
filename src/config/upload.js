import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default cloudinary;

export const ASSET_TYPES = {
  profile: {
    key: "profile",
    folder: "profiles",
    maxWidth: 400,
    maxHeight: 400,
    maxSize: 2 * 1024 * 1024,
    allowedFormats: ["jpg", "jpeg", "png", "webp", "bmp"],
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/bmp"],
  },
  logo: {
    key: "logo",
    folder: "logos",
    maxWidth: 256,
    maxHeight: 256,
    maxSize: 2 * 1024 * 1024,
    allowedFormats: ["jpg", "jpeg", "png", "webp", "svg"],
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
  },
  banner: {
    key: "banner",
    folder: "banners",
    maxWidth: 1200,
    maxHeight: 400,
    maxSize: 5 * 1024 * 1024,
    allowedFormats: ["jpg", "jpeg", "png", "webp"],
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
  },
};
