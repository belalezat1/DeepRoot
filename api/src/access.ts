import type { Account, SourceRecord } from "@deeproot/shared";
import { ApiFailure } from "./errors.js";
import { accountTeamSources } from "./dataPolicy.js";

/** The signed-in user, taken from the Static Web Apps auth header (never from the request body). */
export type SignedInUser = { userId: string };

export interface AccountDirectory {
  getAccount(accountId: string): Promise<Account | null>;
}

/** One message for "missing" and "not allowed" (accounts and reports alike), so nothing can be probed. */
const NOT_FOUND_MESSAGE = "Not found.";

export function notFound(): ApiFailure {
  return new ApiFailure("NOT_FOUND", NOT_FOUND_MESSAGE);
}

export function requireUser(user: SignedInUser | null): SignedInUser {
  if (!user) throw new ApiFailure("UNAUTHENTICATED", "Please sign in.");
  return user;
}

/**
 * Returns the account only if the signed-in user may see it. A missing account and a forbidden one
 * both throw NOT_FOUND, so a caller cannot probe which account IDs exist.
 */
export function requireAccountAccess(account: Account | undefined, userId: string): Account {
  if (!account || !account.allowedUserIds.includes(userId)) throw notFound();
  return account;
}

/** Looks up the account and checks access. Call before any source read, report read, search, or model call. */
export async function authorizeAccount(
  user: SignedInUser,
  accountId: string,
  accounts: AccountDirectory,
): Promise<Account> {
  return requireAccountAccess((await accounts.getAccount(accountId)) ?? undefined, user.userId);
}

/** Defense in depth after retrieval: drops anything outside the account or the user's access list. */
export function filterPermittedSources(
  sources: SourceRecord[],
  accountId: string,
  userId: string,
): SourceRecord[] {
  return accountTeamSources(sources.filter((s) => s.accountId === accountId && s.allowedUserIds.includes(userId)));
}
