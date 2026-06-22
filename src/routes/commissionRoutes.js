import { Router } from "express";
import { authenticate, authorize, authorizeBusinessUser } from "../middlewares/auth.js";
import { apiEndpointLimits } from "../middlewares/advancedRateLimit.js";
import commissionController from "../controllers/commissionController.js";

const router = Router();

router.use(authenticate);

router.post("/withdraw", authorizeBusinessUser, apiEndpointLimits.highFrequency, commissionController.withdrawCommission);
router.get("/balance", authorizeBusinessUser, commissionController.getCommissionBalance);
router.get("/", authorizeBusinessUser, commissionController.getUserCommissions);
router.get("/stats", authorizeBusinessUser, commissionController.getCommissionStats);
router.get("/withdrawals", authorizeBusinessUser, commissionController.getWithdrawalHistory);

router.post(
  "/:id/cancel",
  authorize("super_admin", "admin"),
  commissionController.cancelCommission,
);

export default router;
