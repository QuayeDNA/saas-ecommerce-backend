import commissionService from "../services/commissionService.js";

class CommissionController {
  async withdrawCommission(req, res, next) {
    try {
      const { amount } = req.body;
      const userId = req.user._id;

      if (!amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Amount must be greater than zero",
        });
      }

      const result = await commissionService.withdrawCommission(userId, amount);
      res.json({
        success: true,
        message: `GHS ${amount.toFixed(2)} transferred to main wallet`,
        data: result,
      });
    } catch (error) {
      if (
        error.message === "Insufficient commission balance" ||
        error.message === "User not found"
      ) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }
      next(error);
    }
  }

  async getCommissionBalance(req, res, next) {
    try {
      const userId = req.user._id;
      const balance = await commissionService.getCommissionBalance(userId);
      res.json({ success: true, data: balance });
    } catch (error) {
      if (error.message === "User not found") {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }
      next(error);
    }
  }

  async getUserCommissions(req, res, next) {
    try {
      const isAdmin = req.user.userType === "super_admin";
      const userId = isAdmin ? null : req.user._id;
      const { status, startDate, endDate, page, limit } = req.query;
      const result = await commissionService.getUserCommissions(
        userId,
        { status, startDate, endDate, isAdmin },
        { page: parseInt(page) || 1, limit: parseInt(limit) || 20 },
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getCommissionStats(req, res, next) {
    try {
      const userId = req.user._id;
      const stats = await commissionService.getCommissionStats(userId);
      res.json({ success: true, data: stats });
    } catch (error) {
      next(error);
    }
  }

  async cancelCommission(req, res, next) {
    try {
      const { id } = req.params;
      const adminId = req.user._id;
      const commission = await commissionService.cancelCommission(id, adminId);
      res.json({
        success: true,
        message: "Commission cancelled",
        data: commission,
      });
    } catch (error) {
      if (
        error.message === "Commission not found" ||
        error.message === "Commission is already cancelled"
      ) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }
      next(error);
    }
  }

  async getWithdrawalHistory(req, res, next) {
    try {
      const isAdmin = req.user.userType === "super_admin";
      const userId = isAdmin ? null : req.user._id;
      const { page, limit } = req.query;
      const result = await commissionService.getWithdrawalHistory(userId, {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 20,
        isAdmin,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export default new CommissionController();
