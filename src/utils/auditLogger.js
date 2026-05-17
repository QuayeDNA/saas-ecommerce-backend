import auditLogService from "../services/auditLogService.js";

export async function logAuditAction(req, payload) {
  try {
    if (req?.logAuditAction) {
      return await req.logAuditAction(payload);
    }

    return await auditLogService.logAction({
      ...payload,
      req,
    });
  } catch {
    return null;
  }
}
