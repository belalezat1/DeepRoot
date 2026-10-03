# Deeproot: Product Requirements Document

**Version:** Hackathon MVP, October 3, 2026
**Deadline:** Working five-minute demo within 24 hours

## Product summary

Deeproot helps an account team carry context from emails before a meeting into a cited meeting report and an owned next action. It offers Glean-like cross-source questions, but its primary workflow is meeting-to-action: preserve what the client asked for, identify what the team committed to, and create reviewed work in Linear.

Glean already offers broad enterprise search, sales briefs, meeting action items, and agents. Deeproot's hackathon focus is a single visible path from source evidence to a reviewed work item.

## Users and problem

- **Primary user:** An account manager preparing for and following up on a client meeting.
- **Secondary user:** A delivery teammate who receives the resulting Linear issue.

Client requirements live in emails, while commitments happen in conversation. A normal meeting summary may omit an earlier detail; a follow-up task may never get created. Deeproot should make the supporting evidence easy to inspect before anyone acts.

## Demo scenario

Use fictional Acme and BetaCo records; no real payroll or client data.

- **Acme customer email:** Requests payroll exports for both US and Canada subsidiaries.
- **Acme internal email:** Notes that the current export supports only the US subsidiary.
- **Recorded meeting:** An account representative promises an export by Friday without repeating the two-subsidiary detail.
- **Deeproot output:** Connects the meeting promise to both emails, flags the Canada gap, and drafts a Linear issue with "US and Canada subsidiaries" in its acceptance criteria.
- **Security check:** The presenter asks about BetaCo payroll information and receives no restricted content.

## Required features

| ID | Requirement | Acceptance condition |
| --- | --- | --- |
| P1 | Pre-meeting account page | Shows recent emails, a short brief, open questions, and links to original excerpts. |
| P2 | Meeting ingestion | Uploads a prerecorded 25–30 second WAV clip, transcribes it with Azure Speech, and allows transcript correction. |
| P3 | Cited report | Shows summary, decisions, commitments, proposed owner, due date, open questions, risks, and suggested follow-up. Material claims link to email or transcript excerpts. |
| P4 | Honest uncertainty | Missing owners or dates appear as Unknown; the app does not invent them. |
| P5 | Linear action | Presents an editable issue draft. Create in Linear makes one real issue after review and returns its working link. |
| P6 | Follow-up chat | Answers questions about Acme using permitted account sources and visible citations. |
| P7 | Check claim | Rates a draft client statement as Supported, Uncertain, or Contradicted, explains why, and suggests accurate wording. |
| P8 | Access control | Account permissions are checked on the server before retrieval or model calls. BetaCo content is absent from Acme answers. |

## Experience and visual direction

The demo has three principal views:

1. **Before the meeting:** Acme overview, dated email cards, brief, and a clear Process meeting action.
2. **Meeting and report:** Audio/transcription progress followed by a report. Selecting a citation opens the exact source excerpt alongside the claim.
3. **Act and explore:** Editable Linear issue draft, issue link after creation, chat, and Check claim.

Use the GirlHacks dark forest palette with teal, lime, gold, and restrained purple accents. A small root or branch trail can connect emails, meeting lines, and the issue. Prioritize readable text and obvious actions over decorative animation.

## Success measures

- The report carries both subsidiaries from the email into the ticket's acceptance criteria.
- Each commitment and identified risk has inspectable supporting evidence.
- A user-reviewed action creates one real Linear issue and displays its link.
- A contradictory proposed client reply is flagged.
- A restricted-account question leaks no text, title, or citation.
- The complete presentation takes less than five minutes on a deployed app.

## Scope and constraints

Synthetic emails and client records are acceptable. Azure transcription, model processing, retrieval, hosting, and Linear issue creation should be real. Live Microsoft 365 or ADP tenant access, autonomous client emails, GitHub PR generation, and broad enterprise connectors are outside this 24-hour MVP.
