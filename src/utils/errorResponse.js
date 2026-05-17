/**
 * Developer Experience Error Codes
 * These are application-level error identifiers that do not expose HTTP status
 * codes to the client.
 */

export const ERROR_CODES = {
  // Authentication & Authorization (10xx)
  AUTH_INVALID_CREDENTIALS: {
    code: "AUTH_INVALID_CREDENTIALS",
    message: "Invalid email or password",
    httpStatus: 401,
  },
  AUTH_INVALID_PASSWORD: {
    code: "AUTH_INVALID_PASSWORD",
    message: "Current password is incorrect",
    httpStatus: 400,
  },
  AUTH_TOKEN_EXPIRED: {
    code: "AUTH_TOKEN_EXPIRED",
    message: "Your session has expired. Please log in again.",
    httpStatus: 401,
  },
  AUTH_FORBIDDEN: {
    code: "AUTH_FORBIDDEN",
    message: "You do not have permission to perform this action",
    httpStatus: 403,
  },

  // Resource Not Found (20xx)
  USR_NOT_FOUND: {
    code: "USR_NOT_FOUND",
    message: "User not found",
    httpStatus: 404,
  },
  ORDER_NOT_FOUND: {
    code: "ORDER_NOT_FOUND",
    message: "Order not found",
    httpStatus: 404,
  },
  STOREFRONT_NOT_FOUND: {
    code: "STOREFRONT_NOT_FOUND",
    message: "Storefront not found",
    httpStatus: 404,
  },

  // Validation & Input (30xx)
  VALIDATION_ERROR: {
    code: "VALIDATION_ERROR",
    message: "Please check your input and try again",
    httpStatus: 400,
  },
  DUPLICATE_EMAIL: {
    code: "DUPLICATE_EMAIL",
    message: "This email is already registered",
    httpStatus: 409,
  },
  INVALID_INPUT: {
    code: "INVALID_INPUT",
    message: "Invalid request data",
    httpStatus: 400,
  },

  // Server Errors (90xx)
  INTERNAL_SERVER_ERROR: {
    code: "INTERNAL_SERVER_ERROR",
    message: "An unexpected error occurred. Our team has been notified",
    httpStatus: 500,
  },
};

/**
 * Standardized error response format
 */
export function respondWithError(
  res,
  errorKey,
  customMessage = null,
  additionalData = null,
) {
  const errorDef = ERROR_CODES[errorKey];

  if (!errorDef) {
    console.error(`Unknown error code: ${errorKey}`);
    return res.status(500).json({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: ERROR_CODES.INTERNAL_SERVER_ERROR.message,
      ...(additionalData && { details: additionalData }),
    });
  }

  const response = {
    success: false,
    code: errorDef.code,
    message: customMessage || errorDef.message,
  };

  if (additionalData) {
    response.details = additionalData;
  }

  return res.status(errorDef.httpStatus).json(response);
}

export function respondWithSuccess(
  res,
  data = null,
  message = "Success",
  httpStatus = 200,
) {
  const response = {
    success: true,
    message,
  };

  if (data) {
    response.data = data;
  }

  return res.status(httpStatus).json(response);
}
