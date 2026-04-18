import { AsyncLocalStorage } from "async_hooks";

const requestContextStorage = new AsyncLocalStorage();

export function runWithRequestContext(context, callback) {
  return requestContextStorage.run(context, callback);
}

export function getCurrentRequestContext() {
  return requestContextStorage.getStore() || null;
}

export default {
  runWithRequestContext,
  getCurrentRequestContext,
};
