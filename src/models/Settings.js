import mongoose from "mongoose";

const settingsSchema = new mongoose.Schema(
  {
    // Site Management
    isSiteOpen: {
      type: Boolean,
      default: true,
    },
    customMessage: {
      type: String,
      default:
        "We're currently performing maintenance. Please check back later.",
    },
    requireApprovalForSignup: {
      type: Boolean,
      default: true,
    },

    // Storefront Settings
    autoApproveStorefronts: {
      type: Boolean,
      default: false,
    },

    // Commission Rates by User Type
    agentCommission: {
      type: Number,
      default: 5.0,
      min: 0,
      max: 100,
    },
    superAgentCommission: {
      type: Number,
      default: 7.5,
      min: 0,
      max: 100,
    },
    dealerCommission: {
      type: Number,
      default: 10.0,
      min: 0,
      max: 100,
    },
    superDealerCommission: {
      type: Number,
      default: 12.5,
      min: 0,
      max: 100,
    },
    defaultCommissionRate: {
      type: Number,
      default: 1.0,
      min: 0,
      max: 100,
    },

    // API Settings
    mtnApiKey: {
      type: String,
      default: "",
    },
    telecelApiKey: {
      type: String,
      default: "",
    },
    airtelTigoApiKey: {
      type: String,
      default: "",
    },
    apiEndpoint: {
      type: String,
      default: "https://api.telecomsaas.com",
    },

    // Paystack integration settings
    paystackEnabled: {
      type: Boolean,
      default: false,
    },
    paystackTestSecretKey: {
      type: String,
      default: "",
    },
    paystackTestPublicKey: {
      type: String,
      default: "",
    },
    paystackLiveSecretKey: {
      type: String,
      default: "",
    },
    paystackLivePublicKey: {
      type: String,
      default: "",
    },

    // Wallet Settings - User type-based minimum top-up amounts
    minimumTopUpAmounts: {
      agent: {
        type: Number,
        default: 10.0,
        min: 0,
      },
      super_agent: {
        type: Number,
        default: 50.0,
        min: 0,
      },
      dealer: {
        type: Number,
        default: 100.0,
        min: 0,
      },
      super_dealer: {
        type: Number,
        default: 200.0,
        min: 0,
      },
      default: {
        type: Number,
        default: 10.0,
        min: 0,
      },
    },

    // Payout Settings - minimum amounts per destination type
    minimumPayoutAmounts: {
      mobile_money: {
        type: Number,
        default: 1.0,
        min: 0,
      },
      bank_account: {
        type: Number,
        default: 50.0,
        min: 0,
      },
    },

    // Transaction Fee Settings — Storefront payments
    // Paystack's actual collection fee (for display/calculation purposes)
    paystackCollectionFeePercent: {
      type: Number,
      default: 1.95,
      min: 0,
      max: 100,
    },
    // Platform surcharge percentage added on top of Paystack fee
    platformFeePercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    // Whether to delegate total fees (paystack + platform) to the customer
    delegateFeesToCustomer: {
      type: Boolean,
      default: true,
    },
    // Transaction Fee Settings — Wallet top-up (independent from storefront)
    walletTopUpCollectionFeePercent: {
      type: Number,
      default: 1.95,
      min: 0,
      max: 100,
    },
    walletTopUpPlatformFeePercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    walletTopUpDelegateFeesToCustomer: {
      type: Boolean,
      default: true,
    },
    // Paystack transfer fees (for payout cost tracking)
    paystackTransferFees: {
      mobile_money: {
        type: Number,
        default: 1.0, // GHS 1 flat
        min: 0,
      },
      bank_account: {
        type: Number,
        default: 8.0, // GHS 8 flat
        min: 0,
      },
    },
    // Who pays the payout transfer fee: 'platform' or 'agent'
    payoutFeeBearer: {
      type: String,
      enum: ['platform', 'agent'],
      default: 'agent',
    },
    // Percentage the platform earns on every payout withdrawal (on top of Paystack's fixed fee)
    platformPayoutFeePercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    // When true, agents can withdraw directly via Paystack without admin approval
    autoPayoutEnabled: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure only one settings document exists
settingsSchema.statics.getInstance = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

const Settings = mongoose.model("Settings", settingsSchema);

export default Settings;
