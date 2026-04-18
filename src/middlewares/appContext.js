import { resolveAppContextFromRequest } from "../utils/appContextResolver.js";

export function appContextMiddleware() {
  return (req, res, next) => {
    const appContext = resolveAppContextFromRequest(req);
    req.appContext = appContext;
    res.locals.appContext = appContext;
    next();
  };
}

export default appContextMiddleware;
