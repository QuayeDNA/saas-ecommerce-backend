import { body, param, query } from "express-validator";
import { normalizePhoneNumber } from "../utils/phoneNumber.js";

export const verificationRequestValidation = {
  submitRequest: [
    body("phone")
      .notEmpty().withMessage("Phone number is required")
      .isString().withMessage("Phone must be a string")
      .customSanitizer((phone) => normalizePhoneNumber(phone))
      .isLength({ min: 10, max: 10 })
      .withMessage("Phone must be a valid 10-digit number")
      .matches(/^0\d{9}$/).withMessage("Phone must be a valid 10-digit number"),
    body("source")
      .notEmpty().withMessage("Source is required")
      .isIn(["agent", "customer", "admin"]).withMessage("Source must be agent, customer, or admin"),
  ],

  checkPhone: [
    query("phone")
      .notEmpty().withMessage("Phone number is required")
      .isString().withMessage("Phone must be a string")
      .customSanitizer((phone) => normalizePhoneNumber(phone)),
  ],

  listRequests: [
    query("page")
      .optional()
      .isInt({ min: 1 }).withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100"),
    query("search")
      .optional()
      .isString().withMessage("Search must be a string"),
    query("status")
      .optional()
      .isIn(["pending", "submitted", "approved", "rejected"]).withMessage("Status must be pending, submitted, approved, or rejected"),
    query("source")
      .optional()
      .isIn(["agent", "customer", "admin"]).withMessage("Source must be agent, customer, or admin"),
  ],

  approveRequest: [
    param("id")
      .notEmpty().withMessage("Request ID is required")
      .isMongoId().withMessage("Invalid request ID format"),
  ],

  rejectRequest: [
    param("id")
      .notEmpty().withMessage("Request ID is required")
      .isMongoId().withMessage("Invalid request ID format"),
  ],

  bulkApprove: [
    body("ids")
      .isArray({ min: 1 }).withMessage("IDs array is required with at least one ID"),
    body("ids.*")
      .isMongoId().withMessage("Invalid ID format"),
  ],

  bulkReject: [
    body("ids")
      .isArray({ min: 1 }).withMessage("IDs array is required with at least one ID"),
    body("ids.*")
      .isMongoId().withMessage("Invalid ID format"),
  ],

  bulkSubmit: [
    body("ids")
      .isArray({ min: 1 }).withMessage("IDs array is required with at least one ID"),
    body("ids.*")
      .isMongoId().withMessage("Invalid ID format"),
  ],

  batchIdParam: [
    param("id")
      .notEmpty().withMessage("Batch ID is required")
      .isMongoId().withMessage("Invalid batch ID format"),
  ],

  updateBatchNumbers: [
    param("id")
      .notEmpty().withMessage("Batch ID is required")
      .isMongoId().withMessage("Invalid batch ID format"),
    body("approve")
      .optional()
      .isArray().withMessage("approve must be an array of IDs"),
    body("approve.*")
      .optional()
      .isMongoId().withMessage("Invalid ID format in approve"),
    body("reject")
      .optional()
      .isArray().withMessage("reject must be an array of IDs"),
    body("reject.*")
      .optional()
      .isMongoId().withMessage("Invalid ID format in reject"),
    body()
      .custom((_, { req }) => {
        const { approve = [], reject = [] } = req.body || {};
        if (approve.length === 0 && reject.length === 0) {
          throw new Error("Provide at least one ID to approve or reject");
        }
        return true;
      }),
  ],
};
