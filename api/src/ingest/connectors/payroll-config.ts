import type { InternalAppConnector } from "../internal-app.js";

/**
 * The fictional Payroll Configuration Dashboard: a second internal tool with a different shape
 * (numeric IDs, epoch-ms dates, nested author, list fields, its own client codes). Connecting it
 * took this config and nothing else; it runs through the same engine as the Implementation Tracker.
 */
export const PAYROLL_CONFIG_DASHBOARD: InternalAppConnector = {
  appId: "payroll-config",
  appName: "Payroll Configuration Dashboard",
  fields: {
    id: "cfg_id",
    customerKey: "client_ref",
    title: "setting",
    occurredAt: "last_modified_ms",
    author: "modified_by.name",
  },
  body: [
    { label: "Area", path: "area" },
    { label: "Setting", path: "setting" },
    { label: "Status", path: "state" },
    { label: "Missing", path: "missing", ifMissing: "Nothing" },
    { label: "Employees affected", path: "employees_affected" },
    { label: "Comment", path: "comment" },
  ],
  accounts: {
    "NSL-0042": "northstar",
    "BTC-0007": "betaco",
  },
};
