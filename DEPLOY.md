# Deployment checklist — Roam

## 1. Build and verify

Use Node.js 22 or newer. From this folder, run:

```sh
npm test
node scripts/set-owner-password.js
node server.js
```

`npm` is the Node package manager; `test` invokes the test script defined in `package.json`. `node` runs JavaScript scripts; the password script prompts privately for your password and writes only a salted hash to `.env`. `server.js` starts the matchmaking service. None of these commands use command-line flags. Visit `http://localhost:3000` in a secure-context-capable browser. For matchmaking, use two browsers or real devices accessing the **same server**. Do not commit `.env`.

## 2. Deploy on Render

1. Create a new private GitHub repository and upload the code files (not `.env`, `reports.jsonl`, or `node_modules`).
2. Connect the Render app and choose **New Blueprint**, selecting the GitHub repository. The included `render.yaml` sets up one Node web service with `/api/health` checks and HTTPS.
3. Set `ROAM_PREVIEW_CODE` to a strong random invite code; this keeps the pilot private and blocks anonymous WebSocket connections and indexing. Distribute the code only to trusted testers. When asked for `PRIVATE_FILTER_PASSWORD_HASH`, copy the hash value from your local `.env`, **not the plaintext password**. Enter TURN settings only if you have a coturn/TURN server. If Render requires an env-var value and TURN is unavailable, leave it unset/remove the optional entry rather than entering dummy credentials.
4. Wait for **Deploy succeeded**. Use the issued `https://...onrender.com` URL. The site requires HTTPS for browser camera and mic permissions.
5. On the public URL, open two separate browsers, consent to camera/microphone, ensure region preferences are compatible, verify both parties see each other's media and hear sound, send chat, use Skip, Report, and Block. Log in as Owner and confirm password-only gender matching.
6. If you attach a custom domain, update `PUBLIC_ORIGIN` to the exact canonical HTTPS origin and redeploy, so owner cookies and WebSocket origin checks behave as expected.

## 3. Must complete before inviting the general public

- Robust age assurance beyond a self-attested checkbox, proportionate to countries served.
- Moderation coverage, durable report storage, human review, appeals, bans and anti-ban-evasion protections, abuse escalation and emergency handling.
- Publish reviewed Terms, Privacy Notice, community rules, operator identification and a working privacy/safety contact address.
- Configure production TURN on 3478 UDP / 5349 TLS and the necessary relay UDP ports; test difficult networks and bandwidth expenses.
- Reliable hosting (no free-tier idle sleep for a mainstream production service), abuse-rate limits, DDoS mitigation, observability, incident response, backups, and load tests.
- Jurisdiction-specific review for child protection, data privacy, consumer and content-moderation laws.

**Status:** Pilot implementation, invite-code gate, and deploy blueprint are complete. The app is not publicly deployed until an account connection authorizes hosting and its HTTPS service has been verified. A direct connection to other video services' users is not implemented because there is no generic lawful cross-app camera-feed protocol.

## Connected GitHub + Render workflow

A new **private GitHub repository** named `roam-video-chat` is recommended. It can be created at https://github.com/new. Do not place the app on a branch of an unrelated repository. When the repository exists, upload/commit this source tree to its default branch, then create the Render web service from that same repository. The attached `render.yaml` is an Infrastructure-as-Code fallback for Render Blueprints.

Recommended Render pilot variables: `NODE_ENV=production`, `ROAM_PREVIEW_CODE=<your secret>`, `PRIVATE_FILTER_PASSWORD_HASH=<salted hash>`. `PORT` is supplied by Render and should not be hardcoded. `PUBLIC_ORIGIN` is optional if Render provides `RENDER_EXTERNAL_URL`. For basic tests, omit both `TURN_URLS` and `TURN_SHARED_SECRET` until a compatible TURN server is configured. Private pilot is **not** a substitute for age assurance/moderation at public launch.
