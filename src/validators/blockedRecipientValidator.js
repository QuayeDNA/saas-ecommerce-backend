import { body, query, param } from "express-validator";

export const blockedRecipientValidation = {
  list: [
    query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer"),
    query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100"),
    query("search").optional().isString().withMessage("Search must be a string"),
  ],
  block: [
    body("phones")
      .exists().withMessage("phones is required")
      .custom((v) => Array.isArray(v) || typeof v === "string")
      .withMessage("phones must be a string or array of strings"),
    body("phones.*").optional().isString().withMessage("Each phone must be a string"),
    body("reason").optional().isString().withMessage("Reason must be a string"),
    body("reason").optional().isLength({ max: 300 }).withMessage("Reason too long (max 300)"),
  ],
  check: [
    query("phone").notEmpty().withMessage("phone is required").isString().withMessage("phone must be a string"),
  ],
  phoneParam: [
    param("phone").notEmpty().withMessage("phone param is required").isString().withMessage("phone must be a string"),
  ],
  bulkUnblock: [
    body("phones").isArray({ min: 1 }).withMessage("phones array is required"),
    body("phones.*").isString().withMessage("Each phone must be a string"),
  ],
};
