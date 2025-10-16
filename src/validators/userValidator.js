// src/validators/userValidator.js
import Joi from "joi";
import { getBusinessUserTypes } from "../utils/userTypeHelpers.js";

export const userValidation = {
  updateProfile: Joi.object({
    fullName: Joi.string().trim().min(2).max(50),
    phone: Joi.string()
      .pattern(/^\+?[\d\s-()]{10,}$/)
      .messages({
        "string.pattern.base": "Please enter a valid phone number",
      }),
  }),

  changePassword: Joi.object({
    currentPassword: Joi.string().required().messages({
      "any.required": "Current password is required",
    }),
    newPassword: Joi.string().min(6).required().messages({
      "string.min": "New password must be at least 6 characters long",
      "any.required": "New password is required",
    }),
  }),

  updateUserStatus: Joi.object({
    isVerified: Joi.boolean(),
    subscriptionStatus: Joi.string().valid("active", "inactive", "suspended"),
  }),

  afaRegistration: Joi.object({
    fullName: Joi.string().trim().min(2).max(50).required().messages({
      "string.min": "Full name must be at least 2 characters long",
      "string.max": "Full name cannot exceed 50 characters",
      "any.required": "Full name is required",
    }),
    phone: Joi.string()
      .pattern(/^0\d{9}$/)
      .required()
      .messages({
        "string.pattern.base": "Phone number must be 10 digits starting with 0",
        "any.required": "Phone number is required",
      }),
    bundleId: Joi.string().hex().length(24).required().messages({
      "string.hex": "Invalid bundle ID format",
      "string.length": "Invalid bundle ID format",
      "any.required": "Bundle selection is required",
    }),
    ghanaCardNumber: Joi.string()
      .pattern(/^GHA-\d{9}-\d$/i)
      .optional()
      .messages({
        "string.pattern.base": "Ghana Card number must be in format GHA-XXXXXXXXX-X (9 digits in middle, 1 at end)",
      }),
  }),
};
