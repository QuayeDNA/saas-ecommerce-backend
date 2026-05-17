import auditLogService from "../services/auditLogService.js";
import logger from "../utils/logger.js";

function serializeCsvValue(value) {
  if (value === null || value === undefined) return "";
  const stringValue =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  const escaped = stringValue.replace(/"/g, '""');
  return `"${escaped}"`;
}

function buildCsv(logs) {
  const headers = [
    "timestamp",
    "severity",
    "category",
    "action",
    "userId",
    "userType",
    "resource",
    "changes",
    "metadata",
    "ipAddress",
    "userAgent",
  ];

  const rows = logs.map((log) => {
    const userIdValue = log.userId?._id || log.userId || "";
    const row = [
      log.timestamp?.toISOString?.() || "",
      log.severity,
      log.category,
      log.action,
      userIdValue,
      log.userType,
      log.resource,
      log.changes,
      log.metadata,
      log.ipAddress,
      log.userAgent,
    ];
    return row.map(serializeCsvValue).join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

class AuditLogController {
  async getAuditLogs(req, res) {
    try {
      const { page = 1, limit = 20, ...filters } = req.query;
      const result = await auditLogService.getAuditLogs({
        filters,
        pagination: { page, limit },
      });

      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      logger.error(
        `[AuditLogController] getAuditLogs failed: ${error.message}`,
      );
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve audit logs",
      });
    }
  }

  async getUserActivityTimeline(req, res) {
    try {
      const { userId } = req.params;
      const isOwner = req.user?.userId === userId;
      const isAdmin = req.user?.userType === "super_admin";

      if (!isOwner && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      const { page = 1, limit = 20, startDate, endDate } = req.query;
      const result = await auditLogService.getUserActivityTimeline(userId, {
        page,
        limit,
        startDate,
        endDate,
      });

      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      logger.error(
        `[AuditLogController] getUserActivityTimeline failed: ${error.message}`,
      );
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve user activity timeline",
      });
    }
  }

  async getRecentActivity(req, res) {
    try {
      const { limit = 20 } = req.query;
      const logs = await auditLogService.getRecentActivity(limit);
      return res.json({
        success: true,
        logs,
      });
    } catch (error) {
      logger.error(
        `[AuditLogController] getRecentActivity failed: ${error.message}`,
      );
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve recent activity",
      });
    }
  }

  async getAuditStats(req, res) {
    try {
      const { startDate, endDate } = req.query;
      const stats = await auditLogService.getAuditStats({
        startDate,
        endDate,
      });

      return res.json({
        success: true,
        stats,
      });
    } catch (error) {
      logger.error(
        `[AuditLogController] getAuditStats failed: ${error.message}`,
      );
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve audit statistics",
      });
    }
  }

  async exportAuditLogs(req, res) {
    try {
      const { ...filters } = req.query;
      const { logs } = await auditLogService.getAuditLogs({
        filters,
        pagination: { page: 1, limit: 5000 },
      });

      const csv = buildCsv(logs);
      const fileName = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
      return res.status(200).send(csv);
    } catch (error) {
      logger.error(
        `[AuditLogController] exportAuditLogs failed: ${error.message}`,
      );
      return res.status(500).json({
        success: false,
        message: "Failed to export audit logs",
      });
    }
  }
}

export default new AuditLogController();
