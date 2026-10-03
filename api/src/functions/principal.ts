import type { SignedInUser } from "../access.js";

/**
 * The signed-in user from Static Web Apps' x-ms-client-principal header (base64 JSON). Static Web Apps
 * sets this header itself and strips any copy sent by the browser. Returns null when it is missing or
 * unreadable; the user ID never comes from the request body or query.
 */
export function userFromPrincipal(header: string | null | undefined): SignedInUser | null {
  if (!header) return null;
  try {
    const principal = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as { userDetails?: unknown };
    return typeof principal.userDetails === "string" && principal.userDetails
      ? { userId: principal.userDetails }
      : null;
  } catch {
    return null;
  }
}
