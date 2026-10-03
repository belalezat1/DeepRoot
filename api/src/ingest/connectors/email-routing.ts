import { ACCOUNT_MAILBOXES } from "@deeproot/demo";
import type { EmailRouting } from "../email.js";

/** Account mailboxes for the demo accounts. In production this table lives with account config. */
export const DEMO_EMAIL_ROUTING: EmailRouting = {
  mailboxes: {
    [ACCOUNT_MAILBOXES.northstar]: "northstar",
    [ACCOUNT_MAILBOXES.betaco]: "betaco",
  },
};
