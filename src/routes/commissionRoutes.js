import { Router } from "express";
import { authenticate, authorize } from "../middlewares/auth.js";
import commissionController from "../controllers/commissionController.js";

const router = Router();

router.use(authenticate);

router.post(
  "/process-daily",
  authorize("super_admin", "admin"),
  commissionController.processDailyCommissions,
);

router.post("/withdraw", commissionController.withdrawCommission);
router.get("/balance", commissionController.getCommissionBalance);
router.get("/", commissionController.getUserCommissions);
router.get("/stats", commissionController.getCommissionStats);

router.post(
  "/:id/cancel",
  authorize("super_admin", "admin"),
  commissionController.cancelCommission,
);

export default router;
