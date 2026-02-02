// src/services/paymentVerificationService.js
import logger from '../utils/logger.js';

class PaymentVerificationService {
  /**
   * Verify mobile money payment
   * @param {Object} paymentData - Payment data from order
   * @param {Object} verificationData - Verification data from agent
   * @returns {Object} Verification result
   */
  async verifyMobileMoneyPayment(paymentData, verificationData) {
    const { mobileMoney } = paymentData;
    const { transactionId, amountPaid, senderNumber } = verificationData;

    // Basic validation
    if (!transactionId) {
      throw new Error('Transaction ID is required for mobile money verification');
    }

    if (!amountPaid || amountPaid <= 0) {
      throw new Error('Valid payment amount is required');
    }

    // Calculate expected amount from order
    const expectedAmount = paymentData.amount || 0;

    // Allow for small discrepancies (GHS 0.01 tolerance)
    const tolerance = 0.01;
    const amountDifference = Math.abs(amountPaid - expectedAmount);

    if (amountDifference > tolerance) {
      throw new Error(`Payment amount mismatch. Expected: GHS ${expectedAmount}, Received: GHS ${amountPaid}`);
    }

    // Network-specific validation
    const networkValidation = this.validateNetworkSpecificData(mobileMoney.network, {
      transactionId,
      senderNumber,
      amountPaid
    });

    if (!networkValidation.isValid) {
      throw new Error(networkValidation.error);
    }

    // Check for duplicate transaction IDs (basic check)
    const duplicateCheck = await this.checkDuplicateTransactionId(transactionId, mobileMoney.network);
    if (duplicateCheck.isDuplicate) {
      throw new Error('This transaction ID has already been used for payment verification');
    }

    return {
      isValid: true,
      confidence: networkValidation.confidence || 'medium',
      notes: `Mobile money payment verified: ${mobileMoney.network} - ${transactionId}`,
      metadata: {
        network: mobileMoney.network,
        transactionId,
        amountPaid,
        senderNumber,
        verificationTimestamp: new Date()
      }
    };
  }

  /**
   * Verify bank transfer payment
   * @param {Object} paymentData - Payment data from order
   * @param {Object} verificationData - Verification data from agent
   * @returns {Object} Verification result
   */
  async verifyBankTransferPayment(paymentData, verificationData) {
    const { bankTransfer } = paymentData;
    const { transactionId, amountPaid, senderAccount } = verificationData;

    // Basic validation
    if (!transactionId) {
      throw new Error('Transaction ID/Reference is required for bank transfer verification');
    }

    if (!amountPaid || amountPaid <= 0) {
      throw new Error('Valid payment amount is required');
    }

    // Calculate expected amount from order
    const expectedAmount = paymentData.amount || 0;

    // Allow for small discrepancies (GHS 0.01 tolerance)
    const tolerance = 0.01;
    const amountDifference = Math.abs(amountPaid - expectedAmount);

    if (amountDifference > tolerance) {
      throw new Error(`Payment amount mismatch. Expected: GHS ${expectedAmount}, Received: GHS ${amountPaid}`);
    }

    // Bank-specific validation
    const bankValidation = this.validateBankSpecificData(bankTransfer.bankName, {
      transactionId,
      senderAccount,
      amountPaid
    });

    if (!bankValidation.isValid) {
      throw new Error(bankValidation.error);
    }

    // Check for duplicate transaction IDs
    const duplicateCheck = await this.checkDuplicateBankTransactionId(transactionId, bankTransfer.bankName);
    if (duplicateCheck.isDuplicate) {
      throw new Error('This transaction reference has already been used for payment verification');
    }

    return {
      isValid: true,
      confidence: bankValidation.confidence || 'medium',
      notes: `Bank transfer verified: ${bankTransfer.bankName} - ${transactionId}`,
      metadata: {
        bankName: bankTransfer.bankName,
        transactionId,
        amountPaid,
        senderAccount,
        verificationTimestamp: new Date()
      }
    };
  }

  /**
   * Verify Paystack payment (future implementation)
   * @param {Object} paymentData - Payment data from order
   * @param {Object} verificationData - Verification data from agent
   * @returns {Object} Verification result
   */
  async verifyPaystackPayment(paymentData, verificationData) {
    // For now, Paystack payments are auto-verified via webhooks
    // This method is for manual verification if needed
    const { paystack } = paymentData;

    if (!paystack?.reference) {
      throw new Error('Paystack reference is required');
    }

    // In a real implementation, you would verify with Paystack API
    // For now, we'll assume it's valid if reference exists
    return {
      isValid: true,
      confidence: 'high',
      notes: `Paystack payment auto-verified: ${paystack.reference}`,
      metadata: {
        reference: paystack.reference,
        verificationTimestamp: new Date()
      }
    };
  }

  /**
   * Validate network-specific data for mobile money
   * @param {string} network - Mobile network (MTN, Vodafone, AirtelTigo)
   * @param {Object} data - Transaction data
   * @returns {Object} Validation result
   */
  validateNetworkSpecificData(network, data) {
    const { transactionId, senderNumber, amountPaid } = data;

    switch (network.toLowerCase()) {
      case 'mtn':
        // MTN transaction IDs are typically 10-12 digits
        if (!/^\d{10,12}$/.test(transactionId.replace(/\s/g, ''))) {
          return {
            isValid: false,
            error: 'Invalid MTN transaction ID format. Should be 10-12 digits.',
            confidence: 'low'
          };
        }
        break;

      case 'vodafone':
        // Vodafone transaction IDs vary, but often start with specific patterns
        if (transactionId.length < 6) {
          return {
            isValid: false,
            error: 'Invalid Vodafone transaction ID. Too short.',
            confidence: 'low'
          };
        }
        break;

      case 'airteltigo':
        // AirtelTigo transaction IDs are typically numeric
        if (!/^\d+$/.test(transactionId.replace(/\s/g, ''))) {
          return {
            isValid: false,
            error: 'Invalid AirtelTigo transaction ID. Should contain only numbers.',
            confidence: 'low'
          };
        }
        break;

      default:
        return {
          isValid: false,
          error: `Unsupported network: ${network}`,
          confidence: 'low'
        };
    }

    // Validate sender number if provided
    if (senderNumber && !/^(\+233|0)[0-9]{9}$/.test(senderNumber.replace(/\s/g, ''))) {
      return {
        isValid: false,
        error: 'Invalid sender phone number format',
        confidence: 'medium'
      };
    }

    // Amount validation (reasonable limits for mobile money)
    if (amountPaid < 0.1 || amountPaid > 10000) {
      return {
        isValid: false,
        error: 'Payment amount outside reasonable limits (GHS 0.10 - GHS 10,000)',
        confidence: 'low'
      };
    }

    return {
      isValid: true,
      confidence: 'medium',
      notes: `${network} transaction format validated`
    };
  }

  /**
   * Validate bank-specific data
   * @param {string} bankName - Bank name
   * @param {Object} data - Transaction data
   * @returns {Object} Validation result
   */
  validateBankSpecificData(bankName, data) {
    const { transactionId, senderAccount, amountPaid } = data;

    // Basic transaction ID validation
    if (transactionId.length < 6) {
      return {
        isValid: false,
        error: 'Transaction reference too short. Should be at least 6 characters.',
        confidence: 'low'
      };
    }

    // Amount validation (reasonable limits for bank transfers)
    if (amountPaid < 1 || amountPaid > 50000) {
      return {
        isValid: false,
        error: 'Payment amount outside reasonable limits (GHS 1 - GHS 50,000)',
        confidence: 'low'
      };
    }

    // Bank-specific validation could be added here
    // For now, basic validation is sufficient

    return {
      isValid: true,
      confidence: 'medium',
      notes: `${bankName} transaction format validated`
    };
  }

  /**
   * Check for duplicate mobile money transaction IDs
   * @param {string} transactionId - Transaction ID to check
   * @param {string} network - Mobile network
   * @returns {Object} Duplicate check result
   */
  async checkDuplicateTransactionId(transactionId, network) {
    // This would check against a database of verified transactions
    // For now, return false (no duplicate checking implemented)
    // In production, you'd query the database for recent verifications

    logger.info(`Duplicate check for ${network} transaction: ${transactionId}`);

    // TODO: Implement actual duplicate checking
    return {
      isDuplicate: false,
      lastUsed: null
    };
  }

  /**
   * Check for duplicate bank transaction IDs
   * @param {string} transactionId - Transaction ID to check
   * @param {string} bankName - Bank name
   * @returns {Object} Duplicate check result
   */
  async checkDuplicateBankTransactionId(transactionId, bankName) {
    // Similar to mobile money duplicate checking
    logger.info(`Duplicate check for ${bankName} transaction: ${transactionId}`);

    // TODO: Implement actual duplicate checking
    return {
      isDuplicate: false,
      lastUsed: null
    };
  }

  /**
   * Main verification method that routes to appropriate verifier
   * @param {string} paymentType - Type of payment (mobile_money, bank_transfer, paystack)
   * @param {Object} paymentData - Payment data from order
   * @param {Object} verificationData - Verification data from agent
   * @returns {Object} Verification result
   */
  async verifyPayment(paymentType, paymentData, verificationData) {
    try {
      switch (paymentType) {
        case 'mobile_money':
          return await this.verifyMobileMoneyPayment(paymentData, verificationData);

        case 'bank_transfer':
          return await this.verifyBankTransferPayment(paymentData, verificationData);

        case 'paystack':
          return await this.verifyPaystackPayment(paymentData, verificationData);

        default:
          throw new Error(`Unsupported payment type: ${paymentType}`);
      }
    } catch (error) {
      logger.error(`Payment verification failed for ${paymentType}:`, error);
      return {
        isValid: false,
        error: error.message,
        confidence: 'low'
      };
    }
  }

  /**
   * Get verification statistics for analytics
   * @param {Date} startDate - Start date for statistics
   * @param {Date} endDate - End date for statistics
   * @returns {Object} Verification statistics
   */
  async getVerificationStats(startDate, endDate) {
    // This would aggregate verification data from the database
    // For now, return mock statistics

    return {
      totalVerifications: 45,
      successfulVerifications: 42,
      failedVerifications: 3,
      averageVerificationTime: '2.5 hours',
      paymentMethodBreakdown: {
        mobile_money: { total: 30, successful: 28, failed: 2 },
        bank_transfer: { total: 12, successful: 11, failed: 1 },
        paystack: { total: 3, successful: 3, failed: 0 }
      },
      commonFailureReasons: [
        { reason: 'Amount mismatch', count: 2 },
        { reason: 'Invalid transaction ID', count: 1 }
      ]
    };
  }
}

export default new PaymentVerificationService();