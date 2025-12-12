import announcementService from "../services/announcementService.js";

/**
 * Create a new announcement
 */
export const createAnnouncement = async (req, res) => {
  try {
    const announcementData = req.body;
    const createdBy = req.user._id;

    const announcement = await announcementService.createAnnouncement(
      announcementData,
      createdBy
    );

    res.status(201).json({
      success: true,
      message: "Announcement created successfully",
      data: announcement,
    });
  } catch (error) {
    console.error("Error in createAnnouncement controller:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create announcement",
      error: error.message,
    });
  }
};

/**
 * Get all announcements with optional filters
 */
export const getAllAnnouncements = async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      targetAudience: req.query.targetAudience,
      type: req.query.type,
    };

    // Remove undefined values
    Object.keys(filters).forEach((key) => {
      if (filters[key] === undefined) {
        delete filters[key];
      }
    });

    const announcements = await announcementService.getAnnouncements(filters);

    res.status(200).json({
      success: true,
      data: announcements,
    });
  } catch (error) {
    console.error("Error in getAllAnnouncements controller:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch announcements",
      error: error.message,
    });
  }
};

/**
 * Get active announcements for the authenticated user
 */
export const getMyActiveAnnouncements = async (req, res) => {
  try {
    const userId = req.user._id;
    const announcements =
      await announcementService.getActiveAnnouncementsForUser(userId);

    res.status(200).json({
      success: true,
      data: announcements,
    });
  } catch (error) {
    console.error("Error in getMyActiveAnnouncements controller:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch active announcements",
      error: error.message,
    });
  }
};

/**
 * Get unread announcements for the authenticated user
 */
export const getMyUnreadAnnouncements = async (req, res) => {
  try {
    const userId = req.user._id;
    const announcements =
      await announcementService.getUnreadAnnouncementsForUser(userId);

    res.status(200).json({
      success: true,
      data: announcements,
    });
  } catch (error) {
    console.error("Error in getMyUnreadAnnouncements controller:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch unread announcements",
      error: error.message,
    });
  }
};

/**
 * Get a single announcement by ID
 */
export const getAnnouncementById = async (req, res) => {
  try {
    const { id } = req.params;
    const announcement = await announcementService.getAnnouncementById(id);

    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: "Announcement not found",
      });
    }

    res.status(200).json({
      success: true,
      data: announcement,
    });
  } catch (error) {
    console.error("Error in getAnnouncementById controller:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch announcement",
      error: error.message,
    });
  }
};

/**
 * Update an announcement
 */
export const updateAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const announcement = await announcementService.updateAnnouncement(
      id,
      updates
    );

    res.status(200).json({
      success: true,
      message: "Announcement updated successfully",
      data: announcement,
    });
  } catch (error) {
    console.error("Error in updateAnnouncement controller:", error);

    if (error.message === "Announcement not found") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to update announcement",
      error: error.message,
    });
  }
};

/**
 * Delete an announcement
 */
export const deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const announcement = await announcementService.deleteAnnouncement(id);

    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: "Announcement not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Announcement deleted successfully",
    });
  } catch (error) {
    console.error("Error in deleteAnnouncement controller:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete announcement",
      error: error.message,
    });
  }
};

/**
 * Mark announcement as viewed
 */
export const markAsViewed = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    await announcementService.markAsViewed(id, userId);

    res.status(200).json({
      success: true,
      message: "Announcement marked as viewed",
    });
  } catch (error) {
    console.error("Error in markAsViewed controller:", error);

    if (error.message === "Announcement not found") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to mark announcement as viewed",
      error: error.message,
    });
  }
};

/**
 * Mark announcement as acknowledged
 */
export const markAsAcknowledged = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    await announcementService.markAsAcknowledged(id, userId);

    res.status(200).json({
      success: true,
      message: "Announcement marked as acknowledged",
    });
  } catch (error) {
    console.error("Error in markAsAcknowledged controller:", error);

    if (error.message === "Announcement not found") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to mark announcement as acknowledged",
      error: error.message,
    });
  }
};

/**
 * Broadcast an existing announcement
 */
export const broadcastAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;

    await announcementService.broadcastAnnouncement(id);

    res.status(200).json({
      success: true,
      message: "Announcement broadcast successfully",
    });
  } catch (error) {
    console.error("Error in broadcastAnnouncement controller:", error);
    res.status(500).json({
      success: false,
      message: "Failed to broadcast announcement",
      error: error.message,
    });
  }
};

/**
 * Get announcement statistics
 */
export const getAnnouncementStats = async (req, res) => {
  try {
    const { id } = req.params;
    const stats = await announcementService.getAnnouncementStats(id);

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error in getAnnouncementStats controller:", error);

    if (error.message === "Announcement not found") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to fetch announcement stats",
      error: error.message,
    });
  }
};

/**
 * Get predefined templates
 */
export const getTemplates = async (req, res) => {
  try {
    const templates = announcementService.getTemplates();

    res.status(200).json({
      success: true,
      data: templates,
    });
  } catch (error) {
    console.error("Error in getTemplates controller:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch templates",
      error: error.message,
    });
  }
};

export default {
  createAnnouncement,
  getAllAnnouncements,
  getMyActiveAnnouncements,
  getMyUnreadAnnouncements,
  getAnnouncementById,
  updateAnnouncement,
  deleteAnnouncement,
  markAsViewed,
  markAsAcknowledged,
  broadcastAnnouncement,
  getAnnouncementStats,
  getTemplates,
};
