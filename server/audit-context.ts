import { AsyncLocalStorage } from "node:async_hooks";
export const auditContext = new AsyncLocalStorage<{
  actorRole: string;
  ip: string;
  sessionId: string;
  device: string;
}>();
