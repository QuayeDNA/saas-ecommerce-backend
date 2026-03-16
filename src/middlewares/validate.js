// src/middlewares/validate.js
import { validationResult } from 'express-validator';
import logger from '../utils/logger.js';

const validate = (validationRules) => {
  return (req, res, next) => {
    const errors = validationResult(req);
  
    if (!errors.isEmpty()) {
      const errorsArray = errors.array().map(error => ({
        type: 'field',
        value: error.value,
        msg: error.msg,
        path: error.param || error.path,
        location: error.location,
      }));
      const firstErrorMsg = errorsArray[0]?.msg || 'Validation failed';
      logger.warn(`Validation failed: ${JSON.stringify(errorsArray)}`);
      return res.status(400).json({
        success: false,
        message: firstErrorMsg,
        errors: errorsArray,
      });
    }
    next();
  }
};

export default validate;
