// src/routes/userRoutes.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import userController from "../controllers/userController.js";
import { BUSINESS_ROLES } from "../constants/roles.js";
import { authenticate, authorize } from "../middlewares/auth.js";
import validate from "../middlewares/validate.js";
import { userValidation } from "../validators/userValidator.js";

// ── Multer config for profile picture uploads ──────────────────────────────
const UPLOAD_DIR = process.env.UPLOADS_PATH
  || path.resolve(process.cwd(), process.env.NODE_ENV === "production" ? "uploads" : "uploads/dev");

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const userId = req.user?.userId || "anonymous";
    const userDir = path.join(UPLOAD_DIR, userId);
    fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|bmp)$/i;
    if (!allowed.test(path.extname(file.originalname))) {
      return cb(new Error("Only image files are allowed (jpg, jpeg, png, gif, webp, bmp)"));
    }
    cb(null, true);
  },
});

const router = express.Router();

// Profile management (all authenticated users)
router.get("/profile", authenticate, userController.getProfile);
router.put(
  "/profile",
  authenticate,
  validate(userValidation.updateProfile),
  userController.updateProfile,
);
router.post(
  "/profile-picture",
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
  userController.uploadProfilePicture,
);
router.delete(
  "/profile-picture",
  authenticate,
  userController.deleteProfilePicture,
);
router.post(
  "/change-password",
  authenticate,
  validate(userValidation.changePassword),
  userController.changePassword,
);

// AFA Registration (all authenticated users)
router.post(
  "/afa-registration",
  authenticate,
  validate(userValidation.afaRegistration),
  userController.afaRegistration,
);
router.get(
  "/afa-registration",
  authenticate,
  userController.getAfaRegistration,
);
router.get("/afa-bundles", authenticate, userController.getAfaBundles);

// User management (All agent types can view their subordinates, Super admin can view all)
router.get(
  "/",
  authenticate,
  authorize(...BUSINESS_ROLES, "super_admin"),
  userController.getUsers,
);
router.get(
  "/with-wallet",
  authenticate,
  authorize("super_admin"),
  userController.getUsersWithWallet,
);
router.get(
  "/stats",
  authenticate,
  authorize(...BUSINESS_ROLES, "super_admin"),
  userController.getUserStats,
);
router.get(
  "/dashboard-stats",
  authenticate,
  authorize("super_admin"),
  userController.getDashboardStats,
);
router.get(
  "/chart-data",
  authenticate,
  authorize("super_admin"),
  userController.getChartData,
);
router.get("/:id", authenticate, userController.getUserById);

// Admin only routes
router.put(
  "/:id/status",
  authenticate,
  authorize("super_admin"),
  validate(userValidation.updateUserStatus),
  userController.updateUserStatus,
);
router.delete(
  "/:id",
  authenticate,
  authorize("super_admin"),
  userController.deleteUser,
);

export default router;
