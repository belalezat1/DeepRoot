# Northstar meeting clip script

Record this as a 25–30 second clip with two speakers at a normal pace. Maya speaks first, so Speech diarization labels her speaker "1" (see `DEMO_SPEAKER_NAMES`). The words must match `NORTHSTAR_MEETING_TRANSCRIPT` in [src/fixtures.ts](src/fixtures.ts), which is also the fallback if Azure Speech fails.

> **Maya:** Before we wrap up, where are we on the October 15 payroll launch?
>
> **Sam:** Almost everything is configured. The open item is state tax setup for Ohio and Pennsylvania.
>
> **Maya:** What happens if that isn't done in time?
>
> **Sam:** Then the October 15 payroll may slip for those employees.
>
> **Maya:** Who's handling it on your side?
>
> **Sam:** Let me confirm with the team and get back to you.

## Recording from Zoom

Zoom saves `.m4a` (audio only) or `.mp4`. The upload accepts WAV only, so convert first:

```sh
ffmpeg -i audio.m4a -ac 1 -ar 16000 meeting.wav
```

Keep `meeting.wav` on the demo laptop. Don't download it from Zoom during the presentation.

## Where each fact lives

The meeting alone is vague. The other sources fill it in, and each one is a different kind of input:

| Fact | Source |
| --- | --- |
| 38 employees in OH and PA lack state tax setup; first payroll is October 15 | Customer email (plain text) |
| Waiting on the Ohio withholding account number; launch at risk if it's not in by October 8 | Internal email (HTML) |
| Tracker ticket IT-5120 is Blocked, Unassigned, due October 8 | Implementation Tracker |
| Ohio (24 employees) and Pennsylvania local tax (14 employees) settings are INCOMPLETE | Payroll Configuration Dashboard |
| The launch "may slip"; nobody on the call names an owner | This meeting |
| Ohio and Pennsylvania local taxes were flagged at kickoff | Kickoff meeting (seeded) |

BetaCo records (marked `BLUEHERON-7731`) exist in every input type and must never appear for a Northstar user.
