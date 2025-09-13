// src/validators/authValidator.js
import { body } from "express-validator";

export const registerAgentValidation = [
  body("fullName")
    .trim()
    .notEmpty()
    .withMessage("Full name is required")
    .isLength({ min: 2, max: 50 })
    .withMessage("Full name must be between 2 and 50 characters"),

  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Please provide a valid email"),

  body("phone")
    .isMobilePhone()
    .withMessage("Please provide a valid phone number"),

  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters long")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage(
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),

  body("businessName")
    .trim()
    .notEmpty()
    .withMessage("Business name is required")
    .isLength({ min: 2, max: 100 })
    .withMessage("Business name must be between 2 and 100 characters"),

  body("businessCategory")
    .optional()
    .isIn(["electronics", "fashion", "food", "services", "other"])
    .withMessage("Invalid business category"),

  body("subscriptionPlan")
    .optional()
    .isIn(["basic", "premium", "enterprise"])
    .withMessage("Invalid subscription plan"),

  body("userType")
    .optional()
    .isIn(["agent", "super_agent", "dealer", "super_dealer"])
    .withMessage(
      "Invalid user type. Must be agent, super_agent, dealer, or super_dealer"
    ),

  body("tenantId")
    .optional()
    .isMongoId()
    .withMessage("Invalid tenant ID format"),
];

export const loginValidation = [
  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Please provide a valid email"),

  body("password").notEmpty().withMessage("Password is required"),

  body("rememberMe")
    .optional()
    .isBoolean()
    .withMessage("Remember me must be a boolean value"),
];

export const forgotPasswordValidation = [
  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Please provide a valid email"),
];

export const resetPasswordValidation = [
  body("token").notEmpty().withMessage("Reset token is required"),

  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters long")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage(
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
];

export const registerSuperAdminValidation = [
  body("fullName")
    .trim()
    .notEmpty()
    .withMessage("Full name is required")
    .isLength({ min: 2, max: 50 })
    .withMessage("Full name must be between 2 and 50 characters"),

  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Please provide a valid email"),

  body("phone")
    .isMobilePhone()
    .withMessage("Please provide a valid phone number"),

  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters long")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage(
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
];
