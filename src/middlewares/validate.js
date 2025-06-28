// src/middlewares/validate.js
import { validationResult } from 'express-validator';
import logger from '../utils/logger.js';

const validate = (validationRules) => {
  return (req, res, next) => {
    const errors = validationResult(req);
  
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map(error => ({
        field: error.path,
        message: error.msg
      }));
      logger.warn(`Validation failed: ${JSON.stringify(errorMessages)}`);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errorMessages
      });
    }
    next();
  }
};

export default validate;
