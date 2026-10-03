import { BETACO_CANARY, DEMO_USERS } from "@deeproot/demo";
import { describe, expect, it } from "vitest";
import { ALL_SOURCES, IDS, QUOTES } from "../testing/agent.js";
import { locateQuote, validateCitation, type CitationScope } from "./citations.js";

const northstarOnly = ALL_SOURCES.filter((s) => s.accountId === "northstar");
const scope: CitationScope = {
  accountId: "northstar",
  userId: DEMO_USERS.presenter,
  sourcesById: new Map(northstarOnly.map((s) => [s.id, s])),
};
const body = (id: string) => ALL_SOURCES.find((s) => s.id === id)!.body;

describe("validateCitation", () => {
  it("accepts a verbatim quote and adds exact offsets", () => {
    const c = validateCitation({ sourceId: IDS.tracker, quote: QUOTES.trackerUnassigned }, scope)!;
    expect(c.quote).toBe(QUOTES.trackerUnassigned);
    expect(body(IDS.tracker).slice(c.startOffset, c.endOffset)).toBe(QUOTES.trackerUnassigned);
  });

  it("rejects a fabricated source ID", () => {
    expect(validateCitation({ sourceId: "northstar-email-made-up", quote: QUOTES.customer38 }, scope)).toBeNull();
  });

  it("rejects a fabricated quote", () => {
    expect(validateCitation({ sourceId: IDS.customerEmail, quote: "All 38 employees are fully configured." }, scope)).toBeNull();
  });

  it("rejects a paraphrase of a real line", () => {
    const paraphrase = "38 employees in Ohio and Pennsylvania do not have state tax setup in the new system.";
    expect(validateCitation({ sourceId: IDS.customerEmail, quote: paraphrase }, scope)).toBeNull();
  });

  it("rejects a real quote attributed to the wrong source", () => {
    expect(validateCitation({ sourceId: IDS.tracker, quote: QUOTES.customer38 }, scope)).toBeNull();
  });

  it("rejects a real BetaCo quote: the source was never in this context", () => {
    const betaco = ALL_SOURCES.find((s) => s.accountId === "betaco" && s.kind === "email")!;
    expect(validateCitation({ sourceId: betaco.id, quote: `Reference ${BETACO_CANARY}.` }, scope)).toBeNull();
  });

  it("rejects a source of another account even if it was wrongly in the map", () => {
    const betaco = ALL_SOURCES.find((s) => s.accountId === "betaco")!;
    const leaky = { ...scope, sourcesById: new Map([[betaco.id, betaco]]) };
    expect(validateCitation({ sourceId: betaco.id, quote: betaco.body.slice(0, 30) }, leaky)).toBeNull();
  });

  it("rejects a source the user may not see, even in the right account", () => {
    const hidden = { ...northstarOnly[0]!, allowedUserIds: ["someone-else"] };
    const s = { ...scope, sourcesById: new Map([[hidden.id, hidden]]) };
    expect(validateCitation({ sourceId: hidden.id, quote: hidden.body.slice(0, 30) }, s)).toBeNull();
  });

  it("rejects quotes too short to be evidence, and malformed citations", () => {
    expect(validateCitation({ sourceId: IDS.tracker, quote: "Blocked" }, scope)).toBeNull();
    expect(validateCitation({ sourceId: IDS.tracker }, scope)).toBeNull();
    expect(validateCitation("Status: Blocked", scope)).toBeNull();
  });

  it("tolerates re-wrapped lines, straight quotes, and wrapping quote marks, returning the original text", () => {
    // The internal email body uses a curly apostrophe in "Northstar’s".
    const modelQuote = `"Heads up: Northstar's state tax mapping is still   incomplete"`;
    const c = validateCitation({ sourceId: IDS.internalEmail, quote: modelQuote }, scope)!;
    expect(c.quote).toBe("Heads up: Northstar’s state tax mapping is still incomplete");
  });
});

describe("locateQuote", () => {
  it("matches across a line break the model flattened", () => {
    expect(locateQuote("Status: Blocked\nAssignee: Unassigned", "Blocked Assignee:")).toEqual({ start: 8, end: 25 });
  });
});
