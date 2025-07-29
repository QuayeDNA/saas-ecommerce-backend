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
      const { page = 1, limit = 10, search, userType, status } = req.query;
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
        // Add status filter for super admin
        if (status) {
          query.status = status;
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

  // Get users with wallet information (super admin only)
  async getUsersWithWallet(req, res) {
    try {
      const { page = 1, limit = 20, search, userType, includeWallet = 'true' } = req.query;
      const { userType: requestUserType } = req.user;

      // Only super admin can access this endpoint
      if (requestUserType !== 'super_admin') {
        return res.status(403).json({
          success: false,
          message: "Access denied. Super admin only."
        });
      }

      let query = {};

      // Filter by user type if specified
      if (userType) {
        query.userType = userType;
      }

      // Add search functionality
      if (search) {
        query.$or = [
          { fullName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } }
        ];
      }

      // Select fields including wallet balance
      const selectFields = '-password -refreshToken -verificationToken -resetPasswordToken';
      const users = await User.find(query)
        .select(selectFields)
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
      logger.error(`Get users with wallet error: ${error.message}`);
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
      const { isVerified, subscriptionStatus, userType } = req.body;
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

      // Allow super admins to change user types
      if (userType && ['customer', 'agent', 'super_admin'].includes(userType)) {
        user.userType = userType;
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

  // Get comprehensive dashboard statistics for super admin
  async getDashboardStats(req, res) {
    try {
      const { userType: requestUserType } = req.user;

      if (requestUserType !== 'super_admin') {
        return res.status(403).json({
          success: false,
          message: "Access denied. Super admin privileges required."
        });
      }

      // Import Order model for statistics
      const Order = (await import('../models/Order.js')).default;
      const WalletTransaction = (await import('../models/WalletTransaction.js')).default;
      const Provider = (await import('../models/Provider.js')).default;

      // Calculate date ranges
      const now = new Date();
      const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const last90Days = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      // User Statistics
      const totalUsers = await User.countDocuments();
      const totalAgents = await User.countDocuments({ userType: 'agent' });
      const totalCustomers = await User.countDocuments({ userType: 'customer' });
      const verifiedUsers = await User.countDocuments({ isVerified: true });
      const activeAgents = await User.countDocuments({
        userType: 'agent',
        subscriptionStatus: 'active'
      });
      const pendingAgents = await User.countDocuments({
        userType: 'agent',
        status: 'pending'
      });
      const newUsersThisWeek = await User.countDocuments({
        createdAt: { $gte: last7Days }
      });
      const newUsersThisMonth = await User.countDocuments({
        createdAt: { $gte: last30Days }
      });

      // Order Statistics
      const totalOrders = await Order.countDocuments();
      const completedOrders = await Order.countDocuments({ status: 'completed' });
      const pendingOrders = await Order.countDocuments({ status: 'pending' });
      const failedOrders = await Order.countDocuments({ status: 'failed' });
      const ordersThisWeek = await Order.countDocuments({
        createdAt: { $gte: last7Days }
      });
      const ordersThisMonth = await Order.countDocuments({
        createdAt: { $gte: last30Days }
      });

      // Revenue Statistics
      const totalRevenue = await Order.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]);
      const revenueThisWeek = await Order.aggregate([
        { 
          $match: { 
            status: 'completed',
            createdAt: { $gte: last7Days }
          }
        },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]);
      const revenueThisMonth = await Order.aggregate([
        { 
          $match: { 
            status: 'completed',
            createdAt: { $gte: last30Days }
          }
        },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]);

      // Provider Statistics
      const totalProviders = await Provider.countDocuments();
      const activeProviders = await Provider.countDocuments({ status: 'active' });
      const newProvidersThisMonth = await Provider.countDocuments({
        createdAt: { $gte: last30Days }
      });

      // Wallet Statistics
      const totalTransactions = await WalletTransaction.countDocuments();
      const transactionsThisWeek = await WalletTransaction.countDocuments({
        createdAt: { $gte: last7Days }
      });
      const totalWalletBalance = await WalletTransaction.aggregate([
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]);

      // Recent Activity (last 10 items)
      const recentUsers = await User.find()
        .select('fullName email userType createdAt status')
        .sort({ createdAt: -1 })
        .limit(10);

      const recentOrders = await Order.find()
        .select('orderNumber totalAmount status createdAt')
        .sort({ createdAt: -1 })
        .limit(10);

      const recentTransactions = await WalletTransaction.find()
        .select('amount type description createdAt')
        .sort({ createdAt: -1 })
        .limit(10);

      // Calculate percentages and rates
      const userVerificationRate = totalUsers > 0 ? Math.round((verifiedUsers / totalUsers) * 100) : 0;
      const orderSuccessRate = totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;
      const agentActivationRate = totalAgents > 0 ? Math.round((activeAgents / totalAgents) * 100) : 0;

      const stats = {
        users: {
          total: totalUsers,
          agents: totalAgents,
          customers: totalCustomers,
          verified: verifiedUsers,
          unverified: totalUsers - verifiedUsers,
          activeAgents,
          inactiveAgents: totalAgents - activeAgents,
          pendingAgents,
          newThisWeek: newUsersThisWeek,
          newThisMonth: newUsersThisMonth,
          verificationRate: userVerificationRate
        },
        orders: {
          total: totalOrders,
          completed: completedOrders,
          pending: pendingOrders,
          failed: failedOrders,
          thisWeek: ordersThisWeek,
          thisMonth: ordersThisMonth,
          successRate: orderSuccessRate
        },
        revenue: {
          total: totalRevenue[0]?.total || 0,
          thisWeek: revenueThisWeek[0]?.total || 0,
          thisMonth: revenueThisMonth[0]?.total || 0
        },
        providers: {
          total: totalProviders,
          active: activeProviders,
          newThisMonth: newProvidersThisMonth
        },
        wallet: {
          totalTransactions,
          thisWeek: transactionsThisWeek,
          totalBalance: totalWalletBalance[0]?.total || 0
        },
        rates: {
          userVerification: userVerificationRate,
          orderSuccess: orderSuccessRate,
          agentActivation: agentActivationRate
        },
        recentActivity: {
          users: recentUsers,
          orders: recentOrders,
          transactions: recentTransactions
        }
      };

      res.json({
        success: true,
        stats
      });
    } catch (error) {
      logger.error(`Get dashboard stats error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get dashboard statistics"
      });
    }
  }

  // Get chart data for super admin dashboard
  async getChartData(req, res) {
    try {
      const { userType: requestUserType } = req.user;

      if (requestUserType !== 'super_admin') {
        return res.status(403).json({
          success: false,
          message: "Access denied. Super admin privileges required."
        });
      }

      // Import Order model for statistics
      const Order = (await import('../models/Order.js')).default;
      const WalletTransaction = (await import('../models/WalletTransaction.js')).default;

      // Generate last 30 days data
      const days = 30;
      const chartData = {
        labels: [],
        userRegistrations: [],
        orders: [],
        revenue: [],
        orderStatus: {
          completed: 0,
          pending: 0,
          failed: 0
        },
        userTypes: {
          agents: 0,
          customers: 0,
          super_admins: 0
        }
      };

      // Generate labels for last 30 days
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        chartData.labels.push(date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }));
      }

      // Get user registrations per day
      for (let i = days - 1; i >= 0; i--) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - i);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);

        const userCount = await User.countDocuments({
          createdAt: { $gte: startDate, $lt: endDate }
        });
        chartData.userRegistrations.push(userCount);
      }

      // Get orders per day
      for (let i = days - 1; i >= 0; i--) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - i);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);

        const orderCount = await Order.countDocuments({
          createdAt: { $gte: startDate, $lt: endDate }
        });
        chartData.orders.push(orderCount);
      }

      // Get revenue per day
      for (let i = days - 1; i >= 0; i--) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - i);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);

        const revenue = await Order.aggregate([
          { 
            $match: { 
              status: 'completed',
              createdAt: { $gte: startDate, $lt: endDate }
            }
          },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        chartData.revenue.push(revenue[0]?.total || 0);
      }

      // Get order status distribution
      const orderStatusData = await Order.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);
      
      orderStatusData.forEach(item => {
        if (item._id === 'completed') chartData.orderStatus.completed = item.count;
        else if (item._id === 'pending') chartData.orderStatus.pending = item.count;
        else if (item._id === 'failed') chartData.orderStatus.failed = item.count;
      });

      // Get user type distribution
      const userTypeData = await User.aggregate([
        { $group: { _id: '$userType', count: { $sum: 1 } } }
      ]);
      
      userTypeData.forEach(item => {
        if (item._id === 'agent') chartData.userTypes.agents = item.count;
        else if (item._id === 'customer') chartData.userTypes.customers = item.count;
        else if (item._id === 'super_admin') chartData.userTypes.super_admins = item.count;
      });

      res.json({
        success: true,
        chartData
      });
    } catch (error) {
      logger.error(`Get chart data error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get chart data"
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
  getUsersWithWallet: userController.getUsersWithWallet.bind(userController),
  getUserById: userController.getUserById.bind(userController),
  updateUserStatus: userController.updateUserStatus.bind(userController),
  deleteUser: userController.deleteUser.bind(userController),
  getUserStats: userController.getUserStats.bind(userController),
  afaRegistration: userController.afaRegistration.bind(userController),
  getAfaRegistration: userController.getAfaRegistration.bind(userController),
  getDashboardStats: userController.getDashboardStats.bind(userController),
  getChartData: userController.getChartData.bind(userController),
};
