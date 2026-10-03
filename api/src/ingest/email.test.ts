import {
  ACCOUNTS,
  ACCOUNT_MAILBOXES,
  DEMO_USERS,
  NORTHSTAR_CUSTOMER_EMAIL,
  NORTHSTAR_INTERNAL_EMAIL,
} from "@deeproot/demo";
import { describe, expect, it } from "vitest";
import { DEMO_EMAIL_ROUTING } from "./connectors/index.js";
import { emailToSource, ingestEmails, parseRawEmail, routeEmail, stripQuotedReply } from "./email.js";
import { htmlToText } from "./text.js";

const northstar = ACCOUNTS.find((a) => a.id === "northstar")!;
const ingest = (raws: unknown[]) => ingestEmails(raws, DEMO_EMAIL_ROUTING, ACCOUNTS);

describe("plain-text email", () => {
  const [record] = ingest([NORTHSTAR_CUSTOMER_EMAIL]).records;

  it("keeps sender, subject, timestamp, and account", () => {
    expect(record).toMatchObject({
      id: "northstar-email-can7x2lq-mail-northstar-example",
      accountId: "northstar",
      kind: "email",
      title: "Re: Payroll go-live checklist",
      author: "Maya Chen <maya.chen@northstar.example>",
      occurredAt: "2026-09-29T14:12:00.000Z", // -0400 converted to UTC
      allowedUserIds: [DEMO_USERS.presenter],
    });
  });

  it("keeps what Maya wrote and drops her signature and the quoted reply", () => {
    expect(record!.body).toBe(
      [
        "Hi Sam,",
        "",
        "Thanks for the checklist. One thing is still open on our side: 38 employees in Ohio and Pennsylvania still don't have state tax setup in the new system. Our first payroll on the new platform runs October 15, so we need this resolved before then.",
        "",
        "Can you confirm who on your team is handling the state tax mapping?",
        "",
        "Thanks,",
        "Maya",
      ].join("\n"),
    );
  });

  it("prefers plain text when both parts exist", () => {
    const both = { ...NORTHSTAR_CUSTOMER_EMAIL, text: "Plain part.", html: "<p>HTML part.</p>" };
    expect(emailToSource(parseRawEmail(both), northstar).body).toBe("Plain part.");
  });
});

describe("HTML-only email", () => {
  it("falls back to HTML and decodes it into readable text", () => {
    const [record] = ingest([NORTHSTAR_INTERNAL_EMAIL]).records;
    expect(record!.body).toBe(
      [
        "Sam,",
        "Heads up: Northstar’s state tax mapping is still incomplete for Ohio and Pennsylvania. We are waiting on their Ohio withholding account number, and 14 Pennsylvania employees are missing local tax (PSD) codes.",
        "If the Ohio account number doesn't arrive by October 8, the October 15 payroll launch is at risk.",
        "Jordan",
      ].join("\n"),
    );
    expect(record!.body).not.toMatch(/<|margin/); // no tags, no <style> contents
  });

  it("drops scripts, comments, and quoted blockquotes", () => {
    const html =
      "<p>New &amp; current</p><!-- tracking --><script>alert(1)</script>" +
      "<blockquote>Older message</blockquote><ul><li>One</li></ul>";
    expect(htmlToText(html).trim()).toBe("New & current\n- One");
  });

  it("drops Gmail's quoted history block", () => {
    expect(htmlToText('<div>Reply</div><div class="gmail_quote">On Mon wrote: old</div>').trim()).toBe("Reply");
  });
});

describe("stripQuotedReply", () => {
  it("cuts Outlook-style history", () => {
    const text = "New text\n-----Original Message-----\nFrom: Someone\nOld text";
    expect(stripQuotedReply(text)).toBe("New text");
  });

  it("cuts an Outlook header block", () => {
    const text = "New text\n\nFrom: Sam Ortiz\nSent: Monday\nSubject: Checklist\nOld text";
    expect(stripQuotedReply(text).trim()).toBe("New text");
  });

  it("does not cut a sentence that merely starts with From:", () => {
    const text = "Update\nFrom: our side, everything is ready.";
    expect(stripQuotedReply(text)).toBe(text);
  });

  it("cuts a Gmail attribution even when it wraps onto a second line", () => {
    expect(stripQuotedReply("Yes.\nOn Mon, Sep 28, 2026 Sam <s@x.example>\nwrote:\n> old")).toBe("Yes.");
  });

  it("leaves an email with no history alone", () => {
    expect(stripQuotedReply("Line one\nLine two")).toBe("Line one\nLine two");
  });
});

describe("malformed emails", () => {
  const base = NORTHSTAR_CUSTOMER_EMAIL;

  it("rejects bad emails individually and keeps the good ones", () => {
    const result = ingest([
      base,
      null,
      { ...base, messageId: undefined },
      { ...base, messageId: "<no-date>", sentAt: "" },
      { ...base, messageId: "<bad-date>", sentAt: "soon" },
      { ...base, messageId: "<quoted-only>", text: "> only quoted history" },
      { ...base, messageId: "<no-mailbox>", cc: [] },
      base,
    ]);
    expect(result.records).toHaveLength(1);
    expect(result.rejected).toEqual([
      { index: 1, recordId: null, reason: "Email is not an object." },
      { index: 2, recordId: null, reason: "Email has no messageId." },
      { index: 3, recordId: null, reason: "Email <no-date> has no sentAt." },
      { index: 4, recordId: "<bad-date>", reason: "Email <bad-date> has no valid date." },
      { index: 5, recordId: "<quoted-only>", reason: "Email <quoted-only> has no body text." },
      { index: 6, recordId: "<no-mailbox>", reason: "not addressed to any account mailbox" },
      { index: 7, recordId: base.messageId, reason: "duplicate email in this batch" },
    ]);
  });

  it("fills in a missing sender and subject instead of rejecting", () => {
    const [record] = ingest([{ ...base, from: undefined, subject: "  " }]).records;
    expect(record).toMatchObject({ author: "Unknown sender", title: "(no subject)" });
  });

  it("accepts recipients as a comma-separated string and matches mailboxes case-insensitively", () => {
    const email = parseRawEmail({ ...base, cc: `Someone <a@x.example>, ${ACCOUNT_MAILBOXES.northstar.toUpperCase()}` });
    expect(routeEmail(email, DEMO_EMAIL_ROUTING)).toBe("northstar");
  });
});
