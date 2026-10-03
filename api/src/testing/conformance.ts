// Checks a real adapter against the security contract the backend relies on. The Azure teammate can
// run these against their deployed Search/Cosmos adapter after seeding it with buildSeedSources():
//   await checkSourceSearchIsolation(myAzureSearch)  // throws with a reason on any violation
import { BETACO_CANARY, DEMO_USERS } from "@deeproot/demo";
import type { TranscriptSegment } from "@deeproot/shared";
import type { SourceSearch } from "../store/sources.js";

/** Requires a SourceSearch seeded with buildSeedSources(). */
export async function checkSourceSearchIsolation(search: SourceSearch): Promise<void> {
  const presenter = DEMO_USERS.presenter;
  const northstar = await search.search({ accountId: "northstar", userId: presenter, query: "", top: 50 });
  if (northstar.length === 0) throw new Error("No Northstar sources returned: is the store seeded?");
  for (const s of northstar) {
    if (s.accountId !== "northstar") throw new Error(`Returned ${s.accountId} record ${s.id} for a Northstar query`);
    if (!s.allowedUserIds?.includes(presenter)) throw new Error(`Returned ${s.id}, which the user may not see`);
  }
  if (northstar.some((s, i) => i > 0 && s.occurredAt > northstar[i - 1]!.occurredAt)) {
    throw new Error("Empty query must return newest first");
  }
  if (JSON.stringify(northstar).includes(BETACO_CANARY)) throw new Error("BetaCo content returned for Northstar");

  const keyword = await search.search({ accountId: "northstar", userId: presenter, query: `BetaCo ${BETACO_CANARY}`, top: 50 });
  if (JSON.stringify(keyword).includes(BETACO_CANARY)) throw new Error("A BetaCo keyword query leaked BetaCo content");

  const betaco = await search.search({ accountId: "betaco", userId: presenter, query: "", top: 50 });
  if (betaco.length > 0) throw new Error("Presenter can read BetaCo sources: the allowedUserIds filter is missing");

  const limited = await search.search({ accountId: "northstar", userId: presenter, query: "", top: 2 });
  if (limited.length > 2) throw new Error("`top` was not applied");
}

/** Checks TranscribeAudio output shape: ordered segments with non-negative times. */
export function checkTranscriptSegments(segments: TranscriptSegment[]): void {
  if (!Array.isArray(segments)) throw new Error("TranscribeAudio must return an array of segments");
  segments.forEach((s, i) => {
    if (typeof s.text !== "string") throw new Error(`Segment ${i} has no text`);
    if (!(s.startMs >= 0 && s.endMs >= s.startMs)) throw new Error(`Segment ${i} has invalid times`);
    if (s.speaker !== undefined && typeof s.speaker !== "string") throw new Error(`Segment ${i} speaker must be a string label`);
    if (i > 0 && s.startMs < segments[i - 1]!.startMs) throw new Error(`Segment ${i} is out of order`);
  });
}
