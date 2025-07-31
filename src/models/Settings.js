import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  // Site Management
  isSiteOpen: {
    type: Boolean,
    default: true
  },
  customMessage: {
    type: String,
    default: "We're currently performing maintenance. Please check back later."
  },
  
  // Commission Rates
  agentCommission: {
    type: Number,
    default: 5.0,
    min: 0,
    max: 100
  },
  customerCommission: {
    type: Number,
    default: 2.5,
    min: 0,
    max: 100
  },
  
  // API Settings
  mtnApiKey: {
    type: String,
    default: ""
  },
  telecelApiKey: {
    type: String,
    default: ""
  },
  airtelTigoApiKey: {
    type: String,
    default: ""
  },
  apiEndpoint: {
    type: String,
    default: "https://api.telecomsaas.com"
  }
}, {
  timestamps: true
});

// Ensure only one settings document exists
settingsSchema.statics.getInstance = async function() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

const Settings = mongoose.model('Settings', settingsSchema);

export default Settings; 