// src/controllers/userController.js
import User from "../models/User.js";
import logger from "../utils/logger.js";
import crypto from "crypto";

class UserController {
  // Get current user profile
  async getProfile(req, res) {
    try {
      const user = await User.findById(req.user.userId).select('-password -refreshToken');
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      res.json({
        success: true,
        user: user.toJSON()
      });
    } catch (error) {
      logger.error(`Get profile error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get user profile"
      });
    }
  }

  // Update user profile
  async updateProfile(req, res) {
    try {
      const { fullName, phone } = req.body;
      const userId = req.user.userId;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // Update allowed fields
      if (fullName) user.fullName = fullName;
      if (phone) user.phone = phone;

      await user.save();

      logger.info(`Profile updated for user: ${user.email}`);
      res.json({
        success: true,
        message: "Profile updated successfully",
        user: user.toJSON()
      });
    } catch (error) {
      logger.error(`Update profile error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to update profile"
      });
    }
  }

  // Change password
  async changePassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user.userId;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // Verify current password
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: "Current password is incorrect"
        });
      }

      // Update password
      user.password = newPassword;
      await user.save();

      logger.info(`Password changed for user: ${user.email}`);
      res.json({
        success: true,
        message: "Password changed successfully"
      });
    } catch (error) {
      logger.error(`Change password error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to change password"
      });
    }
  }

  // Get users list (Agent only - for viewing their customers)
  async getUsers(req, res) {
    try {
      const { page = 1, limit = 10, search, userType } = req.query;
      const { userType: requestUserType, tenantId, userId } = req.user;

      let query = {};

      // If agent, only show their customers
      if (requestUserType === 'agent') {
        query.tenantId = userId;
        if (userType) {
          query.userType = userType;
        }
      } else if (requestUserType === 'super_admin') {
        // Super admin can see all users
        if (userType) {
          query.userType = userType;
        }
      } else {
        return res.status(403).json({
          success: false,
          message: "Access denied"
        });
      }

      // Add search functionality
      if (search) {
        query.$or = [
          { fullName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } }
        ];
      }

      const users = await User.find(query)
        .select('-password -refreshToken -verificationToken -resetPasswordToken')
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);

      const total = await User.countDocuments(query);

      res.json({
        success: true,
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      logger.error(`Get users error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get users"
      });
    }
  }

  // Get user by ID (Agent can only view their customers)
  async getUserById(req, res) {
    try {
      const { id } = req.params;
      const { userType: requestUserType, userId: requestUserId } = req.user;

      let user;
      
      if (requestUserType === 'agent') {
        // Agent can only view their customers or themselves
        user = await User.findOne({
          _id: id,
          $or: [
            { tenantId: requestUserId },
            { _id: requestUserId }
          ]
        }).select('-password -refreshToken -verificationToken -resetPasswordToken');
      } else if (requestUserType === 'super_admin') {
        user = await User.findById(id).select('-password -refreshToken -verificationToken -resetPasswordToken');
      } else {
        // Regular users can only view their own profile
        if (id !== requestUserId.toString()) {
          return res.status(403).json({
            success: false,
            message: "Access denied"
          });
        }
        user = await User.findById(id).select('-password -refreshToken -verificationToken -resetPasswordToken');
      }

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      res.json({
        success: true,
        user: user.toJSON()
      });
    } catch (error) {
      logger.error(`Get user by ID error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get user"
      });
    }
  }

  // Update user status (Admin only)
  async updateUserStatus(req, res) {
    try {
      const { id } = req.params;
      const { isVerified, subscriptionStatus } = req.body;
      const { userType: requestUserType } = req.user;

      if (requestUserType !== 'super_admin') {
        return res.status(403).json({
          success: false,
          message: "Access denied. Admin privileges required."
        });
      }

      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // Update allowed status fields
      if (typeof isVerified === 'boolean') {
        user.isVerified = isVerified;
      }
      
      if (subscriptionStatus && user.userType === 'agent') {
        user.subscriptionStatus = subscriptionStatus;
      }

      await user.save();

      logger.info(`User status updated: ${user.email} by ${req.user.email}`);
      res.json({
        success: true,
        message: "User status updated successfully",
        user: user.toJSON()
      });
    } catch (error) {
      logger.error(`Update user status error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to update user status"
      });
    }
  }

  // Delete user (Soft delete)
  async deleteUser(req, res) {
    try {
      const { id } = req.params;
      const { userType: requestUserType, userId: requestUserId } = req.user;

      if (requestUserType !== 'super_admin') {
        return res.status(403).json({
          success: false,
          message: "Access denied. Admin privileges required."
        });
      }

      // Prevent self-deletion
      if (id === requestUserId.toString()) {
        return res.status(400).json({
          success: false,
          message: "You cannot delete your own account"
        });
      }

      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // For now, we'll just mark the user as inactive
      // In a real app, you might want to implement soft delete
      user.subscriptionStatus = 'suspended';
      user.isVerified = false;
      await user.save();

      logger.info(`User deleted: ${user.email} by ${req.user.email}`);
      res.json({
        success: true,
        message: "User deleted successfully"
      });
    } catch (error) {
      logger.error(`Delete user error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to delete user"
      });
    }
  }

  // Get user statistics (for dashboard)
  async getUserStats(req, res) {
    try {
      const { userType: requestUserType, userId } = req.user;

      let stats = {};

      if (requestUserType === 'agent') {
        // Agent stats - their customers
        const totalCustomers = await User.countDocuments({
          tenantId: userId,
          userType: 'customer'
        });

        const verifiedCustomers = await User.countDocuments({
          tenantId: userId,
          userType: 'customer',
          isVerified: true
        });

        const recentCustomers = await User.countDocuments({
          tenantId: userId,
          userType: 'customer',
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        });

        stats = {
          totalCustomers,
          verifiedCustomers,
          unverifiedCustomers: totalCustomers - verifiedCustomers,
          recentCustomers
        };
      } else if (requestUserType === 'super_admin') {
        // Admin stats - all users
        const totalUsers = await User.countDocuments();
        const totalAgents = await User.countDocuments({ userType: 'agent' });
        const totalCustomers = await User.countDocuments({ userType: 'customer' });
        const verifiedUsers = await User.countDocuments({ isVerified: true });
        const activeAgents = await User.countDocuments({
          userType: 'agent',
          subscriptionStatus: 'active'
        });

        stats = {
          totalUsers,
          totalAgents,
          totalCustomers,
          verifiedUsers,
          unverifiedUsers: totalUsers - verifiedUsers,
          activeAgents,
          inactiveAgents: totalAgents - activeAgents
        };
      } else {
        return res.status(403).json({
          success: false,
          message: "Access denied"
        });
      }

      res.json({
        success: true,
        stats
      });
    } catch (error) {
      logger.error(`Get user stats error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get user statistics"
      });
    }
  }

  // AFA Registration endpoint
  async afaRegistration(req, res) {
    try {
      const { fullName, phone, userType } = req.body;
      const userId = req.user.userId;

      // Check if user already has AFA registration
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // Check if user already registered for AFA
      if (user.afaRegistration && user.afaRegistration.status === 'completed') {
        return res.status(400).json({
          success: false,
          message: "AFA registration already completed"
        });
      }

      // Set registration fees
      const registrationFees = {
        agent: 3.00,      // GH¢3
        subscriber: 5.50  // GH¢5.5
      };

      const fee = registrationFees[userType] || registrationFees.subscriber;

      // Check wallet balance
      if (user.walletBalance < fee) {
        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. Required: GH¢${fee}, Available: GH¢${user.walletBalance}`
        });
      }

      // Deduct fee from wallet
      user.walletBalance -= fee;

      // Generate AFA registration ID
      const afaId = `AFA${Date.now()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

      // Update user with AFA registration details
      user.afaRegistration = {
        afaId,
        registrationType: userType,
        fullName,
        phone,
        registrationFee: fee,
        status: 'completed',
        registrationDate: new Date()
      };

      await user.save();

      logger.info(`AFA registration completed for user: ${user.email} - AFA ID: ${afaId}`);
      
      res.json({
        success: true,
        message: "AFA registration completed successfully",
        afaRegistration: user.afaRegistration
      });
    } catch (error) {
      logger.error(`AFA registration error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "AFA registration failed. Please try again."
      });
    }
  }

  // Get AFA registration status
  async getAfaRegistration(req, res) {
    try {
      const userId = req.user.userId;

      const user = await User.findById(userId).select('afaRegistration');
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      res.json({
        success: true,
        afaRegistration: user.afaRegistration || null
      });
    } catch (error) {
      logger.error(`Get AFA registration error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get AFA registration status"
      });
    }
  }
}

const userController = new UserController();
export default {
  getProfile: userController.getProfile.bind(userController),
  updateProfile: userController.updateProfile.bind(userController),
  changePassword: userController.changePassword.bind(userController),
  getUsers: userController.getUsers.bind(userController),
  getUserById: userController.getUserById.bind(userController),
  updateUserStatus: userController.updateUserStatus.bind(userController),
  deleteUser: userController.deleteUser.bind(userController),
  getUserStats: userController.getUserStats.bind(userController),
  afaRegistration: userController.afaRegistration.bind(userController),
  getAfaRegistration: userController.getAfaRegistration.bind(userController),
};
