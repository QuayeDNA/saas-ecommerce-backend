// src/middlewares/auth.js
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import logger from '../utils/logger.js';

export const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      logger.warn('Authentication attempt without token');
      return res.status(401).json({ 
        success: false, 
        message: 'Access denied. No token provided.' 
      });
    }

    // Verify access token
    const decoded = jwt.verify(token, process.env.JWTSECRET);
    const user = await User.findById(decoded.userId).select('-password -refreshToken');
    
    if (!user) {
      logger.warn(`Token valid but user not found: ${decoded.userId}`);
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token. User not found.' 
      });
    }

    req.user = {
      userId: user._id.toString(),
      email: user.email,
      userType: user.userType,
      tenantId: decoded.tenantId ? decoded.tenantId.toString() : user._id.toString(),
      ...user.toJSON()
    };
    
    logger.debug(`Authenticated user: ${user.email}`);
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      logger.warn('Access token expired');
      return res.status(401).json({ 
        success: false, 
        message: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    logger.error(`Token verification failed: ${err.message}`);
    res.status(401).json({ 
      success: false, 
      message: 'Invalid token' 
    });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.userType)) {
      logger.warn(`Unauthorized access attempt by ${req.user.email} to ${req.originalUrl}`);
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Insufficient permissions.' 
      });
    }
    next();
  };
};
