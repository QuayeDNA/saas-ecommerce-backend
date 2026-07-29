import WalletTransaction from '../models/WalletTransaction.js';
import User from '../models/User.js';
import walletService from '../services/walletService.js';

export async function getAdminTransactions(req, res) {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const filter = {};
    if (type && ['credit', 'debit'].includes(type)) filter.type = type;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const txns = await WalletTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('user', 'fullName email phone userType agentCode')
      .populate('approvedBy', 'fullName email')
      .populate('relatedOrder', 'orderNumber');

    const total = await WalletTransaction.countDocuments(filter);

    return res.json({
      success: true,
      transactions: txns,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to get admin transactions' });
  }
}

export async function getAnalytics(req, res) {
  try {
    const analytics = await walletService.getWalletAnalytics(null, {});
    return res.json({ success: true, analytics });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to get wallet analytics' });
  }
}

export async function getPendingRequests(req, res) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const filter = { status: 'pending' };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const requests = await WalletTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('user', 'fullName email phone userType agentCode');

    const total = await WalletTransaction.countDocuments(filter);

    return res.json({
      success: true,
      requests,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to get pending requests' });
  }
}

export async function topUpWallet(req, res) {
  try {
    const { userId, amount, description } = req.body;

    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'User ID and a positive amount are required' });
    }

    const transaction = await walletService.creditWallet(
      userId,
      parseFloat(amount),
      description || 'Wallet top-up via cross-app',
      null,
      { adminAction: true, crossApp: true },
    );

    return res.json({ success: true, message: 'Wallet topped up successfully', transaction });
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 400;
    return res.status(status).json({ success: false, message: error.message });
  }
}

export async function debitWallet(req, res) {
  try {
    const { userId, amount, description } = req.body;

    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'User ID and a positive amount are required' });
    }

    const transaction = await walletService.debitWallet(
      userId,
      parseFloat(amount),
      description || 'Wallet debit via cross-app',
      null,
      { debitedBy: null, crossApp: true },
    );

    return res.json({ success: true, message: 'Wallet debited successfully', transaction });
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : error.message.includes('Insufficient') ? 400 : 500;
    return res.status(status).json({ success: false, message: error.message });
  }
}

export async function processTopUpRequest(req, res) {
  try {
    const { transactionId } = req.params;
    const { approve } = req.body;

    const transaction = await walletService.processTopUpRequest(transactionId, Boolean(approve), null);

    return res.json({
      success: true,
      message: approve ? 'Top-up request approved' : 'Top-up request rejected',
      transaction,
    });
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 400;
    return res.status(status).json({ success: false, message: error.message });
  }
}

export async function getUsers(req, res) {
  try {
    const { page = 1, limit = 20, search, userType, status } = req.query;
    const query = {};

    if (userType) query.userType = userType;
    if (status) query.status = status;

    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { agentCode: { $regex: search, $options: 'i' } },
      ];
    }

    const selectFields = '-password -refreshToken -verificationToken -resetPasswordToken';

    const users = await User.find(query)
      .select(selectFields)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await User.countDocuments(query);

    return res.json({
      success: true,
      users,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to get users' });
  }
}