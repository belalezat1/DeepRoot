# Deeproot demo script (5 minutes)

Aim for **4:30** so there's room for a slow page load. Rehearse on the deployed URL, not localhost.

## Before you present

- [ ] Deployed app is open. Sign-in is off, so every visitor acts as the demo presenter: don't share the URL publicly, since anyone with it can create Linear issues.
- [ ] Second tab: Linear, **Deeproot** team issue list, logged in. Old test issues deleted.
- [ ] `meeting.wav` is on the laptop (see [demo/meeting-script.md](../demo/meeting-script.md)). Don't download it live.
- [ ] Load the Northstar page once beforehand so the brief is cached and appears instantly.
- [ ] Keep the prepared transcript ready to paste (`NORTHSTAR_MEETING_TRANSCRIPT` in `demo/src/fixtures.ts`).
- [ ] Phone or narrow browser window ready if you want to show mobile.

## 1. The problem and the pre-meeting brief (0:00–0:45)

**Show:** the Northstar account page: email cards and the brief.

**Say:**
> "Account teams lose context between emails, meetings, and internal tools. Here's Northstar Logistics, moving payroll onto our platform. Before the meeting, Deeproot has already read their emails, our internal tracker, and the payroll config dashboard. The brief says the October 15 payroll is at risk, and every line links to its source."

**Click** one citation to show the exact excerpt.

## 2. The meeting (0:45–1:15)

**Click** Process meeting and upload `meeting.wav`. While Azure Speech transcribes:

> "This is a 30-second check-in with the client. Listen for who owns the problem."

When the transcript appears, **fix one word** to show it's editable, then **Generate report**.

**If transcription fails:** paste the prepared transcript. Say: "If speech is down, the presenter can paste or correct the transcript; nothing downstream changes."

## 3. The report and its evidence (1:15–2:45)

**Show,** in this order:
1. **Risk:** October 15 payroll may slip for 38 employees. Click the citation; the meeting line and Maya's email open side by side.
2. **Deadline nobody said out loud:** the Ohio account number is needed by **October 8**, from Jordan's internal email and the tracker.
3. **Owner: Unknown.** "Sam said 'let me confirm with the team.' That's not an owner, so Deeproot won't invent one."
4. **Conflict:** the tracker still says go-live October 22; the client says October 15.

> "The meeting alone sounded fine. Deeproot connected it to four other sources and found a launch at risk, a hard deadline, and nobody responsible."

## 4. From report to action: Linear (2:45–3:45)

**Scroll** to the ticket draft. **Edit** one acceptance criterion live.

> "The AI drafts it, but nothing is created until a person reviews it."

**Click** Create in Linear. When the **DEE-** link appears, open it in the Linear tab: title, checklist, High priority, link back to the report.

Optional: click Create again. "Clicking twice returns the same issue, so no duplicates."

**If Linear fails:** click **Open prefilled Linear form** and submit it there. "If the integration is down, the work still isn't lost."

## 5. Ask and check (3:45–4:30)

**Chat:** ask *"What do we need from Northstar, and by when?"* The answer cites the October 8 email.

**Check claim:** paste *"Everything is on track for your October 15 payroll."* It comes back **Contradicted**, with evidence and a safer rewrite.

> "Before anyone emails the client, Deeproot catches promises the records don't support."

## 6. Security and Azure (4:30–5:00)

**Chat:** ask *"What is BetaCo's payroll plan?"*

> "BetaCo is another client this user can't see. Access is checked on the server before any search or AI call, so it returns nothing: no text, no title, no citation. Even a malicious email telling the AI to leak another customer's data can't do it, because the AI never receives that data."

**Close:**
> "Deeproot runs on Azure: Static Web Apps and Functions, Speech for transcription, AI Search with per-user filters, Cosmos DB, and Azure OpenAI as the backup model, all deployed from Bicep. Emails and meetings in, a reviewed, owned action out."

## If something breaks

| Problem | What to do |
|---|---|
| Speech fails | Paste the prepared transcript |
| Report is slow | Keep talking through the brief citations; it usually finishes within 20 seconds |
| Linear fails | Use the prefilled Linear form link |
| Model is down | The brief still shows emails. Open a report generated during rehearsal (keep its link handy) and continue from the Linear step |
