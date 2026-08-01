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
    greetingText: {
      type: String,
      default: "",
    },
    welcomeMessage: {
      type: String,
      default: "Welcome back!",
    },
    showGreetingIcon: {
      type: Boolean,
      default: true,
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
    storefrontsOpen: {
      type: Boolean,
      default: true,
    },
    storefrontsClosedMessage: {
      type: String,
      default:
        "Storefronts are temporarily closed by the admin. Please check back later.",
    },

    // API Settings
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
    paystackWalletTopUpEnabled: {
      type: Boolean,
      default: false,
    },
    paystackStorefrontEnabled: {
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
      elite_dealer: {
        type: Number,
        default: 300.0,
        min: 0,
      },
      master_dealer: {
        type: Number,
        default: 500.0,
        min: 0,
      },
      default: {
        type: Number,
        default: 10.0,
        min: 0,
      },
    },
    // Global paystack minimum for wallet top-ups. Applies to all user types and is enforced
    // during instant (Paystack) top-ups in addition to the user-specific minimum.
    paystackMinimumTopUpAmount: {
      type: Number,
      default: 0.0,
      min: 0,
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
      enum: ["platform", "agent"],
      default: "agent",
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

    // ==========================================================================
    // BryteLinks — Storefront Payment Gate
    // ==========================================================================
    requirePaymentForStorefrontCreation: {
      type: Boolean,
      default: false,
    },
    storefrontCreationFee: {
      type: Number,
      default: 50,
      min: 0,
    },

    // ==========================================================================
    // BryteLinks — Auto-Suspend Inactive Stores
    // ==========================================================================
    autoSuspendInactiveStores: {
      type: Boolean,
      default: false,
    },
    inactivityThresholdDays: {
      type: Number,
      default: 14,
      min: 1,
    },

    // ==========================================================================
    // Referral & Commission Settings
    // ==========================================================================
    referralCommissionPercent: {
      type: Number,
      default: 5.0,
      min: 0,
      max: 100,
    },
    referralProgramEnabled: {
      type: Boolean,
      default: true,
    },
    referralCommissionCap: {
      type: Number,
      default: 0, // 0 = unlimited
      min: 0,
    },
    minOrderAmountForCommission: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ==========================================================================
    // MoMo Bridge — Mobile Money Payment Verification
    // ==========================================================================
    momoBridgeApiKey: {
      type: String,
      default: "",
    },
    momoBridgeRelayUrl: {
      type: String,
      default: "https://momobridge-relay.onrender.com",
    },
    momoBridgeEnabled: {
      type: Boolean,
      default: false,
    },
    mtnOrderRestrictionEnabled: {
      type: Boolean,
      default: false,
    },
    momoBridgeClaimFeePercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    momoBridgeAccountName: {
      type: String,
      default: "",
    },
    momoBridgeAccountNumber: {
      type: String,
      default: "",
    },

    // Cross-app wallet transfers — agent self-service moving balance between apps
    crossAppWalletTransferEnabled: {
      type: Boolean,
      default: false,
    },

    // ==========================================================================
    // Integration Key — Cross-App API Authentication
    // ==========================================================================
    integrationKey: {
      hashedKey: { type: String, default: null },
      label: { type: String, default: "" },
      createdAt: { type: Date, default: null },
      regeneratedAt: { type: Date, default: null },
    },

    // ==========================================================================
    // Connected Apps — Cross-App Connections
    // ==========================================================================
    connectedApps: [{
      appId: { type: String, required: true },
      name: { type: String, required: true },
      baseUrl: { type: String, required: true },
      apiKey: { type: String, required: true },
      enabled: { type: Boolean, default: true },
      connectedAt: { type: Date, default: Date.now },
      lastTestedAt: { type: Date },
    }],
  },
  {
    timestamps: true,
  },
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
