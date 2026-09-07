import express from "express";
import { validationResult } from "express-validator";
import blockedRecipientController from "../controllers/blockedRecipientController.js";
import { blockedRecipientValidation } from "../validators/blockedRecipientValidator.js";
import { authenticate, authorize } from "../middlewares/auth.js";

const router = express.Router();

const validate = (validations) => async (req, res, next) => {
  for (const v of validations) await v.run(req);
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  next();
};

router.use(authenticate);
router.use(authorize("super_admin"));

router.get("/", validate(blockedRecipientValidation.list), blockedRecipientController.list);
router.get("/stats", blockedRecipientController.stats);
router.get("/check", validate(blockedRecipientValidation.check), blockedRecipientController.check);
router.post("/", validate(blockedRecipientValidation.block), blockedRecipientController.block);
router.post("/bulk-unblock", validate(blockedRecipientValidation.bulkUnblock), blockedRecipientController.bulkUnblock);
router.delete("/:phone", validate(blockedRecipientValidation.phoneParam), blockedRecipientController.unblock);

export default router;
