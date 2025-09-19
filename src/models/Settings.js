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

    // Wallet Settings
    minimumTopUpAmount: {
      type: Number,
      default: 100.0,
      min: 0,
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
