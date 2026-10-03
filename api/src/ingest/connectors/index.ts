import type { InternalAppConnector } from "../internal-app.js";
import { IMPLEMENTATION_TRACKER } from "./implementation-tracker.js";
import { PAYROLL_CONFIG_DASHBOARD } from "./payroll-config.js";

export { IMPLEMENTATION_TRACKER, PAYROLL_CONFIG_DASHBOARD };
export { DEMO_EMAIL_ROUTING } from "./email-routing.js";

/** Every connected internal app. Connecting another one: write its config, add it here. */
export const INTERNAL_APP_CONNECTORS: InternalAppConnector[] = [IMPLEMENTATION_TRACKER, PAYROLL_CONFIG_DASHBOARD];
