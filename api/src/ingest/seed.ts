import { ACCOUNTS, DEMO_SOURCES, IMPLEMENTATION_TRACKER_EXPORT } from "@deeproot/demo";
import type { SourceRecord } from "@deeproot/shared";
import { IMPLEMENTATION_TRACKER } from "./connectors/implementation-tracker.js";
import { ingestInternalAppRecords } from "./internal-app.js";

/**
 * Every record to seed into Cosmos DB and AI Search for the demo: the fixture emails plus the
 * Implementation Tracker export run through its connector. Seed from this, not DEMO_SOURCES alone.
 */
export function buildSeedSources(): SourceRecord[] {
  const tracker = ingestInternalAppRecords(IMPLEMENTATION_TRACKER, IMPLEMENTATION_TRACKER_EXPORT, ACCOUNTS);
  for (const r of tracker.rejected) {
    console.info(`Skipped ${IMPLEMENTATION_TRACKER.appName} record ${r.recordId ?? `#${r.index}`}: ${r.reason}`);
  }
  return [...DEMO_SOURCES, ...tracker.records];
}
