import { ACCOUNTS, DEMO_APP_EXPORTS, DEMO_RAW_EMAILS, NORTHSTAR_KICKOFF } from "@deeproot/demo";
import type { Account, SourceRecord } from "@deeproot/shared";
import { DEMO_EMAIL_ROUTING, INTERNAL_APP_CONNECTORS } from "./connectors/index.js";
import { ingestEmails } from "./email.js";
import { assertValidConnector, ingestInternalAppRecords } from "./internal-app.js";
import { meetingToSource } from "./meeting.js";
import type { IngestResult } from "./result.js";

/** Trusted account configuration to load alongside the sources (Cosmos DB `accounts`). */
export const SEED_ACCOUNTS: Account[] = ACCOUNTS;

function account(id: string): Account {
  const found = ACCOUNTS.find((a) => a.id === id);
  if (!found) throw new Error(`Seed references unknown account "${id}"`);
  return found;
}

/** Seed fixtures are curated, so any rejection is a fixture bug: fail loudly, never seed partially. */
function requireClean(label: string, result: IngestResult): SourceRecord[] {
  if (result.rejected.length > 0) {
    const reasons = result.rejected.map((r) => `${r.recordId ?? `#${r.index}`}: ${r.reason}`).join("; ");
    throw new Error(`Seed ${label} has rejected records: ${reasons}`);
  }
  return result.records;
}

/**
 * The canonical demo corpus, ready to upsert into Cosmos DB and index in AI Search as-is:
 * raw emails, the seeded kickoff meeting, and every internal app export, each run through the
 * same ingestion code real data uses. Rejection and attack fixtures are deliberately excluded.
 */
export function buildSeedSources(): SourceRecord[] {
  const sources: SourceRecord[] = [
    ...requireClean("emails", ingestEmails(DEMO_RAW_EMAILS, DEMO_EMAIL_ROUTING, ACCOUNTS)),
    meetingToSource({ account: account("northstar"), ...NORTHSTAR_KICKOFF }),
  ];

  for (const connector of INTERNAL_APP_CONNECTORS) {
    assertValidConnector(connector, ACCOUNTS);
    const rows = DEMO_APP_EXPORTS[connector.appId] ?? [];
    sources.push(...requireClean(connector.appName, ingestInternalAppRecords(connector, rows, ACCOUNTS)));
  }

  const ids = new Set<string>();
  for (const s of sources) {
    if (ids.has(s.id)) throw new Error(`Seed has duplicate source ID "${s.id}"`);
    ids.add(s.id);
  }
  return sources;
}
