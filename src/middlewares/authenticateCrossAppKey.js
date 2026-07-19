import bcrypt from "bcrypt";
import Settings from "../models/Settings.js";

export async function authenticateCrossAppKey(req, res, next) {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ error: "Missing authorization token" });
    }

    const settings = await Settings.getInstance();
    if (!settings?.integrationKey?.hashedKey) {
      return res.status(401).json({ error: "No integration key configured on this server" });
    }

    const valid = await bcrypt.compare(token, settings.integrationKey.hashedKey);
    if (!valid) {
      return res.status(401).json({ error: "Invalid integration key" });
    }

    req.crossAppClient = { authenticated: true };
    next();
  } catch (error) {
    return res.status(500).json({ error: "Authentication error" });
  }
}
