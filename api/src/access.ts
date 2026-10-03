import type { Account, SourceRecord } from "@deeproot/shared";
import { ApiFailure } from "./errors.js";

/**
 * Returns the account only if the signed-in user may see it. A missing account and a forbidden one
 * both throw NOT_FOUND, so a caller cannot probe which account IDs exist.
 */
export function requireAccountAccess(account: Account | undefined, userId: string): Account {
  if (!account || !account.allowedUserIds.includes(userId)) {
    throw new ApiFailure("NOT_FOUND", "Account not found.");
  }
  return account;
}

/** Defense in depth after retrieval: drops anything outside the account or the user's access list. */
export function filterPermittedSources(
  sources: SourceRecord[],
  accountId: string,
  userId: string,
): SourceRecord[] {
  return sources.filter((s) => s.accountId === accountId && s.allowedUserIds.includes(userId));
}
