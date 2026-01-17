import Announcement from "../models/Announcement.js";
import User from "../models/User.js";
import websocketService from "./websocketService.js";

class AnnouncementService {
  /**
   * Create a new announcement
   */
  async createAnnouncement(announcementData, createdBy) {
    try {
      // Set default expiration to 1 day from now if not provided
      if (!announcementData.expiresAt) {
        announcementData.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day
      }

      const announcement = new Announcement({
        ...announcementData,
        createdBy,
      });

      await announcement.save();

      // If status is 'active', broadcast immediately
      if (announcement.status === "active") {
        await this.broadcastAnnouncement(announcement._id);
      }

      return announcement;
    } catch (error) {
      console.error("Error creating announcement:", error);
      throw error;
    }
  }

  /**
   * Get all announcements with optional filters
   */
  async getAnnouncements(filters = {}) {
    try {
      const query = {};

      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.targetAudience) {
        query.targetAudience = filters.targetAudience;
      }

      if (filters.type) {
        query.type = filters.type;
      }

      const announcements = await Announcement.find(query)
        .populate("createdBy", "username email")
        .sort({ createdAt: -1 })
        .lean();

      return announcements;
    } catch (error) {
      console.error("Error fetching announcements:", error);
      throw error;
    }
  }

  /**
   * Get active announcements for a specific user
   */
  async getActiveAnnouncementsForUser(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      const now = new Date();
      const query = {
        status: "active",
        targetAudience: user.userType,
        $and: [
          // Expiration filter
          { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
          // Broadcast timing filter: only show announcements broadcasted after user was created
          // OR announcements that haven't been broadcasted yet
          { $or: [{ broadcastedAt: null }, { broadcastedAt: { $gte: user.createdAt } }] }
        ]
      };

      const announcements = await Announcement.find(query)
        .populate("createdBy", "username email")
        .sort({ priority: -1, createdAt: -1 })
        .lean();

      // Add viewed/acknowledged status for the user
      const announcementsWithStatus = announcements.map((announcement) => ({
        ...announcement,
        hasViewed:
          announcement.viewedBy?.some(
            (v) => v.user.toString() === userId.toString()
          ) || false,
        hasAcknowledged:
          announcement.acknowledgedBy?.some(
            (a) => a.user.toString() === userId.toString()
          ) || false,
      }));

      return announcementsWithStatus;
    } catch (error) {
      console.error("Error fetching active announcements for user:", error);
      throw error;
    }
  }

  /**
   * Get unread announcements for a user
   */
  async getUnreadAnnouncementsForUser(userId) {
    try {
      const allActive = await this.getActiveAnnouncementsForUser(userId);
      return allActive.filter((announcement) => !announcement.hasViewed);
    } catch (error) {
      console.error("Error fetching unread announcements:", error);
      throw error;
    }
  }

  /**
   * Get a single announcement by ID
   */
  async getAnnouncementById(announcementId) {
    try {
      const announcement = await Announcement.findById(announcementId)
        .populate("createdBy", "username email")
        .populate("viewedBy.user", "username email")
        .populate("acknowledgedBy.user", "username email");

      return announcement;
    } catch (error) {
      console.error("Error fetching announcement:", error);
      throw error;
    }
  }

  /**
   * Update an announcement
   */
  async updateAnnouncement(announcementId, updates) {
    try {
      const announcement = await Announcement.findById(announcementId);
      if (!announcement) {
        throw new Error("Announcement not found");
      }

      // Update fields
      Object.keys(updates).forEach((key) => {
        if (
          key !== "_id" &&
          key !== "createdBy" &&
          key !== "viewedBy" &&
          key !== "acknowledgedBy"
        ) {
          announcement[key] = updates[key];
        }
      });

      await announcement.save();

      // If status is active (either was active or became active), broadcast the updated announcement
      if (announcement.status === "active") {
        await this.broadcastAnnouncement(announcement._id);
      }

      return announcement;
    } catch (error) {
      console.error("Error updating announcement:", error);
      throw error;
    }
  }

  /**
   * Delete an announcement
   */
  async deleteAnnouncement(announcementId) {
    try {
      const announcement = await Announcement.findByIdAndDelete(announcementId);
      return announcement;
    } catch (error) {
      console.error("Error deleting announcement:", error);
      throw error;
    }
  }

  /**
   * Mark announcement as viewed by user
   */
  async markAsViewed(announcementId, userId) {
    try {
      const announcement = await Announcement.findById(announcementId);
      if (!announcement) {
        throw new Error("Announcement not found");
      }

      await announcement.markAsViewed(userId);
      return announcement;
    } catch (error) {
      console.error("Error marking announcement as viewed:", error);
      throw error;
    }
  }

  /**
   * Mark announcement as acknowledged by user
   */
  async markAsAcknowledged(announcementId, userId) {
    try {
      const announcement = await Announcement.findById(announcementId);
      if (!announcement) {
        throw new Error("Announcement not found");
      }

      await announcement.markAsAcknowledged(userId);
      return announcement;
    } catch (error) {
      console.error("Error marking announcement as acknowledged:", error);
      throw error;
    }
  }

  /**
   * Broadcast announcement to all eligible users via WebSocket
   */
  async broadcastAnnouncement(announcementId) {
    try {
      console.log(`Starting broadcast for announcement: ${announcementId}`);

      const announcement = await Announcement.findById(announcementId)
        .populate("createdBy", "username email")
        .lean();

      if (!announcement) {
        console.log("Announcement not found");
        return;
      }

      if (announcement.status !== "active") {
        console.log(
          `Announcement status is ${announcement.status}, not broadcasting`
        );
        return;
      }

      // Set broadcastedAt timestamp
      const broadcastTime = new Date();
      const wasPreviouslyBroadcasted = announcement.broadcastedAt !== null;
      
      await Announcement.findByIdAndUpdate(announcementId, {
        broadcastedAt: broadcastTime
      });

      console.log(
        `Broadcasting announcement to audiences: ${announcement.targetAudience.join(
          ", "
        )} ${wasPreviouslyBroadcasted ? '(re-broadcast)' : '(first broadcast)'}`
      );

      // Get eligible users based on target audience array
      let eligibleUsers = [];

      if (
        announcement.targetAudience &&
        announcement.targetAudience.length > 0
      ) {
        if (wasPreviouslyBroadcasted) {
          // For re-broadcasts, only send to users who haven't viewed it yet
          // and were created before the broadcast time
          const viewedUserIds = announcement.viewedBy?.map(v => v.user.toString()) || [];
          
          eligibleUsers = await User.find({
            userType: { $in: announcement.targetAudience },
            createdAt: { $lt: broadcastTime },
            _id: { $nin: viewedUserIds }, // Exclude users who have already viewed it
          }).select("_id username email");
          
          console.log(
            `Found ${
              eligibleUsers.length
            } users for re-broadcast: ${announcement.targetAudience.join(", ")} (new users who haven't viewed it)`
          );
        } else {
          // For first broadcasts, send to all eligible users who existed before broadcast
          eligibleUsers = await User.find({
            userType: { $in: announcement.targetAudience },
            createdAt: { $lt: broadcastTime },
          }).select("_id username email");
          
          console.log(
            `Found ${
              eligibleUsers.length
            } users for first broadcast: ${announcement.targetAudience.join(", ")} (created before broadcast time)`
          );
        }
      } else {
        // If no audience selected, don't broadcast
        console.log("No target audience selected");
        return;
      }

      // Broadcast to eligible users
      const userIds = eligibleUsers.map((user) => user._id.toString());
      console.log(`Broadcasting to ${userIds.length} user(s)`);

      // Actually broadcast via WebSocket
      await websocketService.broadcastAnnouncementToAll(announcement, userIds);

      console.log(
        `Announcement ${announcementId} broadcast to ${userIds.length} users`
      );
    } catch (error) {
      console.error("Error broadcasting announcement:", error);
      throw error;
    }
  }

  /**
   * Auto-expire announcements that have passed their expiry date
   */
  async expireAnnouncements() {
    try {
      const now = new Date();
      const result = await Announcement.updateMany(
        {
          status: "active",
          expiresAt: { $lte: now },
        },
        {
          $set: { status: "expired" },
        }
      );

      console.log(`Expired ${result.modifiedCount} announcements`);
      return result.modifiedCount;
    } catch (error) {
      console.error("Error expiring announcements:", error);
      throw error;
    }
  }

  /**
   * Get announcement statistics
   */
  async getAnnouncementStats(announcementId) {
    try {
      const announcement = await Announcement.findById(announcementId);
      if (!announcement) {
        throw new Error("Announcement not found");
      }

      // Get eligible user count
      const query = {};
      if (announcement.targetAudience !== "all") {
        query.userType = announcement.targetAudience;
      }
      const totalEligibleUsers = await User.countDocuments(query);

      const stats = {
        totalEligibleUsers,
        viewedCount: announcement.viewedBy.length,
        acknowledgedCount: announcement.acknowledgedBy.length,
        viewedPercentage:
          totalEligibleUsers > 0
            ? (
                (announcement.viewedBy.length / totalEligibleUsers) *
                100
              ).toFixed(2)
            : 0,
        acknowledgedPercentage:
          totalEligibleUsers > 0
            ? (
                (announcement.acknowledgedBy.length / totalEligibleUsers) *
                100
              ).toFixed(2)
            : 0,
      };

      return stats;
    } catch (error) {
      console.error("Error fetching announcement stats:", error);
      throw error;
    }
  }

  /**
   * Get predefined templates
   */
  getTemplates() {
    return [
      {
        id: "network_slow",
        name: "Network Slowdown",
        type: "warning",
        priority: "high",
        title: "Network Performance Issue",
        message:
          "We are currently experiencing network slowdowns which may affect order processing. Our team is working to resolve this. Thank you for your patience.",
        actionRequired: false,
      },
      {
        id: "maintenance",
        name: "Scheduled Maintenance",
        type: "maintenance",
        priority: "high",
        title: "Scheduled Maintenance",
        message:
          "The system will be undergoing scheduled maintenance. During this time, some features may be unavailable. We apologize for any inconvenience.",
        actionRequired: false,
      },
      {
        id: "service_restored",
        name: "Service Restored",
        type: "success",
        priority: "medium",
        title: "Service Restored",
        message:
          "All services have been restored and are operating normally. Thank you for your patience during the interruption.",
        actionRequired: false,
      },
      {
        id: "urgent_action",
        name: "Urgent Action Required",
        type: "error",
        priority: "urgent",
        title: "Urgent: Action Required",
        message:
          "Please take immediate action regarding your account. Click the link below for more details.",
        actionRequired: true,
        actionText: "View Details",
        actionUrl: "/dashboard",
      },
      {
        id: "new_feature",
        name: "New Feature Available",
        type: "info",
        priority: "low",
        title: "New Feature Available",
        message:
          "We have released a new feature that will help improve your experience. Check it out now!",
        actionRequired: false,
      },
    ];
  }
}

export default new AnnouncementService();
