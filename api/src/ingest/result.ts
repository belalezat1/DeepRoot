import type { IngestRejection, SourceRecord } from "@deeproot/shared";

/** A raw input that did not become a SourceRecord, and why. */
export type RejectedRecord = IngestRejection;

/** Every batch ingest returns this: one bad input never blocks the rest of the batch. */
export type IngestResult = {
  records: SourceRecord[];
  rejected: RejectedRecord[];
};
