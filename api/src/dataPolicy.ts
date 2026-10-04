import type { PublicSource } from "@deeproot/shared";
import { assistantBoundary } from "@deeproot/shared";
import { ApiFailure } from "./errors.js";

/** Conservative screening for this account-team role. Not a substitute for source-system ACLs
 * or a complete PII classifier: real connectors must exclude personal payroll records upstream.
 */
export function containsPersonalPayroll(value: string): boolean {
  return assistantBoundary(value) === "restricted";
}

export function accountTeamSources<T extends PublicSource>(sources: T[]): T[] {
  return sources.filter((s) => (s as T & { policy?: { classification: string } }).policy?.classification !== "restricted_payroll" && !containsPersonalPayroll(`${s.title}\n${s.body}`));
}

export function assertDeliveryContent(value: string): void {
  if (containsPersonalPayroll(value)) throw new ApiFailure("BAD_REQUEST", "This account-team workspace does not accept individual pay, personal tax or bank details. Remove them before importing.");
}

export function assertDeliveryOutput(value: unknown): void {
  if (containsPersonalPayroll(JSON.stringify(value))) throw new ApiFailure("INVALID_MODEL_OUTPUT", "The generated content was outside this workspace’s data policy. Review the source records and retry.");
}
