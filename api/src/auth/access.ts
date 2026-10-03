import type { Account } from "@deeproot/shared";
import { ApiFailure } from "../errors.js";

/** The signed-in user, taken from the Static Web Apps auth header (never from the request body). */
export type SignedInUser = { userId: string };

export interface AccountDirectory {
  getAccount(accountId: string): Promise<Account | null>;
}

/** Same message for "missing" and "not allowed", so a forbidden account's existence never leaks. */
const NOT_FOUND_MESSAGE = "Not found.";

export function requireUser(user: SignedInUser | null): SignedInUser {
  if (!user) throw new ApiFailure("UNAUTHENTICATED", "Please sign in.");
  return user;
}

/** Call before any source read, report read, search, or model call. Throws NOT_FOUND unless permitted. */
export async function authorizeAccount(
  user: SignedInUser,
  accountId: string,
  accounts: AccountDirectory,
): Promise<Account> {
  const account = await accounts.getAccount(accountId);
  if (!account || !account.allowedUserIds.includes(user.userId)) {
    throw new ApiFailure("NOT_FOUND", NOT_FOUND_MESSAGE);
  }
  return account;
}

export function notFound(): ApiFailure {
  return new ApiFailure("NOT_FOUND", NOT_FOUND_MESSAGE);
}
