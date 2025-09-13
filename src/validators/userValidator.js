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
      .pattern(/^\+?[\d\s-()]{10,}$/)
      .required()
      .messages({
        "string.pattern.base": "Please enter a valid phone number",
        "any.required": "Phone number is required",
      }),
    userType: Joi.string()
      .valid(...getBusinessUserTypes(), "subscriber")
      .required()
      .messages({
        "any.only":
          "User type must be a valid business user type or subscriber",
        "any.required": "User type is required",
      }),
  }),
};
