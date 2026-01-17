import mongoose from "mongoose";

const announcementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      maxlength: 1000,
    },
    type: {
      type: String,
      enum: ["info", "warning", "success", "error", "maintenance"],
      default: "info",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    targetAudience: [
      {
        type: String,
        enum: ["agent", "super_agent", "dealer", "super_dealer", "admin"],
      },
    ],
    status: {
      type: String,
      enum: ["draft", "active", "expired", "archived"],
      default: "active",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    viewedBy: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        viewedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    acknowledgedBy: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        acknowledgedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    template: {
      type: String,
      enum: [
        "network_slow",
        "maintenance",
        "service_restored",
        "urgent_action",
        "new_feature",
        "custom",
      ],
      default: "custom",
    },
    actionRequired: {
      type: Boolean,
      default: false,
    },
    actionUrl: {
      type: String,
      default: null,
    },
    actionText: {
      type: String,
      default: null,
    },
    broadcastedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient querying
announcementSchema.index({ status: 1, createdAt: -1 });
announcementSchema.index({ targetAudience: 1, status: 1 });
announcementSchema.index({ expiresAt: 1 });
announcementSchema.index({ broadcastedAt: 1 });

// Virtual for checking if expired
announcementSchema.virtual("isExpired").get(function () {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
});

// Method to check if user has viewed
announcementSchema.methods.hasViewed = function (userId) {
  return this.viewedBy.some(
    (view) => view.user.toString() === userId.toString()
  );
};

// Method to check if user has acknowledged
announcementSchema.methods.hasAcknowledged = function (userId) {
  return this.acknowledgedBy.some(
    (ack) => ack.user.toString() === userId.toString()
  );
};

// Method to mark as viewed by user
announcementSchema.methods.markAsViewed = function (userId) {
  if (!this.hasViewed(userId)) {
    this.viewedBy.push({ user: userId, viewedAt: new Date() });
  }
  return this.save();
};

// Method to mark as acknowledged by user
announcementSchema.methods.markAsAcknowledged = function (userId) {
  if (!this.hasAcknowledged(userId)) {
    this.acknowledgedBy.push({ user: userId, acknowledgedAt: new Date() });
  }
  return this.save();
};

// Auto-expire announcements
announcementSchema.pre("save", function (next) {
  if (
    this.expiresAt &&
    new Date() > this.expiresAt &&
    this.status === "active"
  ) {
    this.status = "expired";
  }
  next();
});

export default mongoose.model("Announcement", announcementSchema);
