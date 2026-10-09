# Roam public access — verified deployment preparation

## What was actually verified
- On October 9, 2026, `npm test` passed all eight tests in a fresh extraction of the v1.1 ZIP.
- Node.js server and region-aware matchmaking/WebSocket signaling exercised in tests.
- Static HTML element references were checked (51 required IDs present).
- A real two-browser WebRTC camera/audio call was **not** verified. The available Chromium sandbox blocks navigation and captures by managed policy.

## What changed from the private pilot
- `render.yaml` no longer requests `ROAM_PREVIEW_CODE`. For a PUBLIC (open-access) deployment, do not set it in Render's Environment tab.
- GitHub Actions now runs syntax checks and the integration test suite for new commits.
- Code behavior remains unchanged; invitation-code logic remains available when explicitly configured for a private pilot.

## Steps to launch
1. Create a **private** GitHub repository named `roam-video-chat`. Do not publish your source secrets or moderation records. Copy the project contents into the repository root.
2. Connect the repository to Render. Create a Node web service with runtime Node, free plan if desired, build command `npm install --omit=dev`, start command `npm start`, and health check `/api/health`. Or use the included `render.yaml` Blueprint.
3. Set `NODE_ENV=production`. **Do not set `ROAM_PREVIEW_CODE`** for public access. Owner filter password hash is optional; keep the owner hash secret. Render supplies PORT.
4. Verify Render shows a *live* deploy, then verify `GET /api/health` responds `{"status":"ok"}` at your real HTTPS hostname.
5. With two separate physical devices and different networks if possible, verify camera preview, both directions of WebRTC audio/video, text chat, skipping, reporting, blocking and owner password protection. Verify the `turnConfigured` flag at `/api/config`; without a TURN relay, some user pairs will fail despite healthy matchmaking.

## Unresolved public-safety / operational requirements
The repository is currently an MVP; do not present it as fully moderated or audited. Specifically:
- Self-attested 18+ checkbox is not robust age verification.
- Reports are appended to a local `reports.jsonl` file, **not durable on ephemeral Render instances**. Configure durable report capture and staff review before exposing real strangers to one another. Do not misrepresent the working report button as staffed moderation.
- There is no permanent ban system, moderator review dashboard, or abuse-response process.
- There is no configured TURN relay in the provided package.
- Render free plan sleeps when idle, disconnecting concurrent sessions; plan for an always-on host for continuous video chat.
- Neither synthetic browser media nor real cross-network NAT traversal was verified in this run.

A deployment to an HTTPS URL alone does not complete the production-readiness work above.
