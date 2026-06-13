import { Router } from "express";
import { authenticate, authorize } from "../middlewares/auth.js";
import referralController from "../controllers/referralController.js";

const router = Router();

router.use(authenticate);

router.get("/dashboard", referralController.getDashboard);
router.get(
  "/leaderboard",
  authorize("super_admin", "admin"),
  referralController.getLeaderboard,
);
router.get("/tree", referralController.getReferralTree);

router.get(
  "/admin/stats",
  authorize("super_admin", "admin"),
  referralController.getAdminStats,
);
router.get(
  "/admin/users",
  authorize("super_admin", "admin"),
  referralController.getAdminUsers,
);
router.get(
  "/admin/users/:id",
  authorize("super_admin", "admin"),
  referralController.getAdminUserDetail,
);

export default router;
