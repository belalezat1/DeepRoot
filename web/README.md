# Deeproot web

React/Vite frontend for the Acme meeting-to-action demo. It uses `@deeproot/shared` for API contracts and the Acme records in `@deeproot/demo` for mock mode.

## Run

From the repository root:

```sh
npm install
npm run dev --workspace web
```

Open the local URL Vite prints. Mock mode is the default. Follow **Brief → Meeting → Report → Ask & verify**. On Meeting, choose a WAV file or use the prepared transcript fallback. Mock mode previews ticket creation and never claims to create a Linear issue.

For a local Azure Functions backend on port 7071:

```sh
VITE_API_MODE=live npm run dev --workspace web
```

The browser calls the documented `/api` endpoints through Vite's local proxy. The frontend uploads WAV data under the agreed `audio` field and sends the reviewed draft as `{ ticket }`. It reads the shared brief, report, chat, claim, and error response shapes. Static Web Apps should publish `web/dist`; a report link uses `?report=<id>` and calls `GET /api/reports/:id` when opened.

## Check

```sh
npm run typecheck
npm test -- --run web/src/App.test.tsx
```

The UI tests cover evidence navigation, transcript and ticket edits, issue preview state, contradictory claims, and restricted-account answers. The interface uses an original illustrated forest header, evergreen and dusk-purple tones, muted gold accents, and restrained Cinzel headings inspired by the event theme. Layout, controls, and copy remain optimized for reading evidence and completing the meeting workflow.
