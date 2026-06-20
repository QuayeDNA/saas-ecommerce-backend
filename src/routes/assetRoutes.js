import { Router } from "express";
import path from "path";
import fs from "fs";
import { generateInitialsSvg } from "../utils/assetUpload.js";

const router = Router();

router.get("/avatar", (req, res) => {
  const name = req.query.name || "User";
  const size = parseInt(req.query.size, 10) || 200;
  const svg = generateInitialsSvg(name, Math.min(Math.max(size, 32), 512));
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(svg);
});

router.get("/default/:asset", (req, res) => {
  const { asset } = req.params;
  if (!["logo.svg", "banner.svg"].includes(asset)) {
    return res.status(404).json({ success: false, message: "Asset not found" });
  }
  const filePath = path.resolve(process.cwd(), "public", "defaults", asset);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "Default asset not found" });
  }
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Content-Type", "image/svg+xml");
  res.sendFile(filePath);
});

export default router;
