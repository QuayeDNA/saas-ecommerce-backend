import express from "express";
import announcementController from "../controllers/announcementController.js";
import { authenticate, authorize } from "../middlewares/auth.js";

const router = express.Router();

// Admin routes - require super_admin role
router.post(
  "/",
  authenticate,
  authorize("super_admin"),
  announcementController.createAnnouncement
);

router.get(
  "/all",
  authenticate,
  authorize("super_admin"),
  announcementController.getAllAnnouncements
);

router.get(
  "/templates",
  authenticate,
  authorize("super_admin"),
  announcementController.getTemplates
);

router.get(
  "/:id",
  authenticate,
  authorize("super_admin"),
  announcementController.getAnnouncementById
);

router.put(
  "/:id",
  authenticate,
  authorize("super_admin"),
  announcementController.updateAnnouncement
);

router.delete(
  "/:id",
  authenticate,
  authorize("super_admin"),
  announcementController.deleteAnnouncement
);

router.get(
  "/:id/stats",
  authenticate,
  authorize("super_admin"),
  announcementController.getAnnouncementStats
);

router.post(
  "/:id/broadcast",
  authenticate,
  authorize("super_admin"),
  announcementController.broadcastAnnouncement
);

// User routes - accessible to all authenticated users
router.get(
  "/active/me",
  authenticate,
  announcementController.getMyActiveAnnouncements
);

router.get(
  "/unread/me",
  authenticate,
  announcementController.getMyUnreadAnnouncements
);

router.post("/:id/view", authenticate, announcementController.markAsViewed);

router.post(
  "/:id/acknowledge",
  authenticate,
  announcementController.markAsAcknowledged
);

export default router;
