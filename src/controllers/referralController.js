import referralService from "../services/referralService.js";

class ReferralController {
  async getDashboard(req, res, next) {
    try {
      const userId = req.user._id;
      const data = await referralService.getDashboard(userId);
      res.json({ success: true, data });
    } catch (error) {
      if (error.message === "User not found") {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  async getLeaderboard(req, res, next) {
    try {
      const { timeframe, limit } = req.query;
      const data = await referralService.getLeaderboard(
        timeframe || "all-time",
        parseInt(limit) || 20,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getReferralTree(req, res, next) {
    try {
      const userId = req.user._id;
      const { depth } = req.query;
      const data = await referralService.getReferralTree(
        userId,
        parseInt(depth) || 2,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getAdminStats(req, res, next) {
    try {
      const data = await referralService.getAdminStats();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getAdminUsers(req, res, next) {
    try {
      const { search, status, sortBy, sortOrder, page, limit } = req.query;
      const data = await referralService.getAdminUsers(
        { search, status, sortBy, sortOrder: sortOrder ? parseInt(sortOrder) : -1 },
        { page: parseInt(page) || 1, limit: parseInt(limit) || 20 },
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}

export default new ReferralController();
