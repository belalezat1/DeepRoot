# Acme meeting clip script

Record this as a 25–30 second WAV clip (two speakers, normal pace). It must match `ACME_MEETING_TRANSCRIPT` in [src/fixtures.ts](src/fixtures.ts), which is also the fallback if Azure Speech fails.

> **Dana:** Thanks for making time. Our main ask is still the payroll export. When can we have it?
>
> **Marcus:** We can have the payroll export ready for you by Friday.
>
> **Dana:** Great. Who on your side will send it over?
>
> **Marcus:** Let me check with the team and get back to you on that.
>
> **Dana:** Sounds good. Talk soon.

## What the clip is designed to test

- **Lost requirement:** Nobody says "Canada". The report must bring back the "both US and Canada subsidiaries" requirement from Dana's email (`acme-email-customer`).
- **Risk:** Priya's internal email (`acme-email-internal`) says only the US export exists, so "by Friday" for both subsidiaries is a risk.
- **Unknown owner:** Marcus never names who sends it, so the commitment's owner must be `null` (shown as Unknown).
- **Due date:** The meeting is Thursday 2026-10-01, so "Friday" is 2026-10-02.

## Claim check examples

- Contradicted: "Your US and Canada payroll exports will both be ready Friday."
- Supported (rewrite target): "We'll confirm the delivery date for the Canada export after scoping; the US export is on track."
