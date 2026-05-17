import auditLogService from "../services/auditLogService.js";

function getIpAddress(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0].trim();
  }
  return req.ip || null;
}

export default function auditLogger() {
  return (req, _res, next) => {
    req.auditContext = {
      ipAddress: getIpAddress(req),
      userAgent: req.headers["user-agent"] || null,
      userId: req.user?.userId || null,
      userType: req.user?.userType || null,
    };

    req.logAuditAction = async (payload) => {
      return auditLogService.logAction({
        ...payload,
        req,
      });
    };

    next();
  };
}
