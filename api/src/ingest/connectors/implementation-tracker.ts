import type { InternalAppConnector } from "../internal-app.js";

/**
 * The fictional in-house Implementation Tracker. This object is the whole integration:
 * compare it with building and registering a Microsoft Graph connector for Copilot.
 */
export const IMPLEMENTATION_TRACKER: InternalAppConnector = {
  appId: "impl-tracker",
  appName: "Implementation Tracker",
  fields: {
    id: "ticket_id",
    customerKey: "customer.code",
    title: "summary",
    occurredAt: "updated_at",
    author: "updated_by",
  },
  body: [
    { label: "Ticket", path: "ticket_id" },
    { label: "Status", path: "status" },
    { label: "Assignee", path: "assignee", ifMissing: "Unassigned" },
    { label: "Notes", path: "notes" },
  ],
  accounts: {
    "C-1001": "acme",
    "C-2002": "betaco",
  },
};
