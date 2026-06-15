// src/models/ApiUsageLog.js
import mongoose from "mongoose";

const apiUsageLogSchema = new mongoose.Schema({
  apiKeyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ApiKey",
    required: true,
    index: true,
  },
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  method: {
    type: String,
    required: true,
    uppercase: true,
    enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  },
  path: {
    type: String,
    required: true,
  },
  statusCode: {
    type: Number,
    required: true,
  },
  responseTimeMs: {
    type: Number,
    required: true,
  },
  ip: {
    type: String,
    default: "",
  },
  userAgent: {
    type: String,
    default: "",
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

apiUsageLogSchema.index({ apiKeyId: 1, timestamp: -1 });
apiUsageLogSchema.index({ agentId: 1, timestamp: -1 });

const ApiUsageLog = mongoose.model("ApiUsageLog", apiUsageLogSchema);

export default ApiUsageLog;
