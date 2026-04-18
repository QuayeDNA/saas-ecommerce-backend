import {
  runWithRequestContext,
  getCurrentRequestContext,
} from "../utils/requestContext.js";

export function requestContextMiddleware() {
  return (req, _res, next) => {
    const existing = getCurrentRequestContext();
    if (existing) {
      return next();
    }

    return runWithRequestContext(
      {
        appContext: req.appContext || null,
      },
      () => next(),
    );
  };
}

export default requestContextMiddleware;
