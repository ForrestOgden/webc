# Roam — worldwide random video chat

Roam is a runnable **real-user** video chat application using browser-native WebRTC and a Node.js WebSocket matchmaking/signaling server. No database, API keys, paid SDKs, npm dependencies, or fake online users are needed for local testing.

## Quick start

Requires **Node.js 22+**. On Windows, open PowerShell in the extracted folder.

```powershell
node scripts/set-owner-password.js
node server.js
```

Visit **http://localhost:3000** in Chrome or Edge. Enter a password of your choosing in the terminal when prompted. It is saved as a salted scrypt hash in `.env`; only you know the original password.

To test real matchmaking, open the website in **two browser windows** (or different devices on the public deployment). Confirm age 18+, give camera/mic permission, and choose compatible regions. Matches are only created when both clients are searching.

**CLI explained:** `node` launches the Node.js JavaScript runtime. `scripts/set-owner-password.js` is the interactive owner-password setup program. `server.js` starts the app and real-time matchmaking server. Both commands have **no flags**. `Ctrl+C` stops the server.

## Features

- Welcome page with region preferences, self-reported optional gender, adult confirmation, and connection counts drawn from the **real** queue.
- Camera and microphone permission on Start, live local preview, audio/video toggles, instant Skip/Next, End Chat, and secure real-time text messaging.
- Symmetric matchmaking: both sides' region preferences must agree; FIFO queue, exclusion of recently skipped partners for three minutes, auto requeue on disconnect or skip, WebSocket reconnect.
- WebRTC peer-to-peer encrypted video/audio; signaling relays only connection setup data, not calls. Public free STUN for basic connections; optional short-lived TURN credentials for harder network paths.
- Password-only-for-owner gender target filter, enforced on the **server**, never just hidden in JavaScript. Requires gender self-reporting; no gender identity inference from video. Public users cannot set a target gender.
- Per-session block, reporting (append-only reports file for operator review), rate limiting, WebSocket origin checking, restrictive content-security policy, cookie-backed short-lived private owner session.

### Owner-only gender matching

1. Run `node scripts/set-owner-password.js` and enter a strong private password. Restart your Node server if it is already running.
2. On the homepage, click **Owner**, enter that password, and unlock owner mode.
3. Choose **Women / Men / Nonbinary people / Any gender** in the private filter and press Start.
4. The server only pairs you with a participant who has **voluntarily selected that gender**, *and* whose region preferences are compatible. If none are online, the app correctly waits; it never fakes a match. A gender is self-declared and not verified.

The password itself is not recorded, sent to another chat participant, or embedded in the frontend. Session authentication uses a 12-hour `HttpOnly; SameSite=Strict` cookie; the `Secure` attribute is automatically set when `PUBLIC_ORIGIN` starts with `https://`. Sign out from **Owner** to clear the session. Treat the `.env` file as a secret.

## Deploy publicly (people worldwide)

Host the **Node server** somewhere that supports long-running WebSocket connections (a VPS, Railway, Render, Fly.io, etc.). The hosted domain **must have HTTPS** for browsers to allow camera/microphone. `http://localhost:3000` also works locally, but `http://192.168.x.x:3000` generally does **not** permit camera/mic.

1. Set `PUBLIC_ORIGIN=https://your-real-domain.example` on the server to enable secure owner cookie and origin checking.
2. Set `PRIVATE_FILTER_PASSWORD_HASH` on the hosting environment to the generated `.env` value (use the provider's **secrets** facility), or provide a private `.env` on the host.
3. Start with `node server.js` or use the included `Dockerfile`. Put Nginx, Caddy, or the platform's HTTPS proxy in front, with **WebSocket Upgrade** enabled.
4. Set up a **TURN** relay, preferably with coturn, because STUN-only may fail over carrier-grade NAT, enterprise networks, or restrictive firewalls. TURN relays video, uses server bandwidth, and is usually the main infrastructure cost.

### TURN / coturn (for production)

Configure coturn with `use-auth-secret`, `static-auth-secret=<strong-long-random-secret>`, `realm=<your-domain>`, TLS certificate, UDP 3478 and TLS 5349; also allow the TURN relay UDP port range on the firewall. Set these Node environment values to the **same** shared secret and your public relay host:

```dotenv
TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp
TURN_SHARED_SECRET=replace-with-your-coturn-static-auth-secret
```

The server generates an expiring TURN username/password for each app instance. **Do not expose TURN_SHARED_SECRET** to client browsers, commit it, or embed it in frontend files. `/api/config` intentionally exposes only one-hour credentials, not the signing secret.

### Developer verification

```powershell
node --test tests/*.test.js
```

`--test` runs Node's built-in test runner. The argument specifies the automated test files.

### Public endpoints / protocol

- `GET /api/health`: availability; `GET /api/stats`: real user / queue counters; `GET /api/config`: ICE/STUN/TURN client configuration.
- `GET /api/private/status`: owner mode state; `POST /api/private/login` and `/logout`: password-gated control.
- `GET /ws` upgraded to WebSocket. Messages: `hello`, `find`, `matched`, `signal`, `chat`, `skip`, `partner-left`, `block`, `report`, `leave`, `stats`. Signaling payloads and match IDs are validated server-side.

## Integration with other video platforms

**No cross-platform camera-feed scraping is performed.** Other random-chat apps do not ordinarily publish public, reusable live media streams or an interoperable stranger-match queue. Browsers cannot lawfully or technically join another application's private peer-to-peer WebRTC call without the participants and service cooperating. Obtaining a working pool of users requires people to **join Roam**, or a third-party provider to supply a documented API, authorization, and an opt-in media/signaling integration.

Potential future partnership adapters need: platform developer approval, OAuth/API tokens, authorized room/participant discovery, each participant's informed consent, protocol bridge with supported stream formats, and moderation / age policies. A supported partner can invite their users to this application's HTTPS URL without exposing anyone else's private call. **There is no universal feed API, and this release does not claim access to other services' live users.**

## Public-launch limitations and safety

- It is a functioning **local / pilot MVP**, not a fully moderated global consumer service. **Real users only**; online count starts at zero. Without other users on your server, there is nobody to match.
- Checkbox-only 18+ self-attestation is insufficient for a large public stranger-video service. Add credible age assurance, professional moderation, robust ban evasion protections, escalation and response workflows, legal terms/privacy policy, abuse reporting and removal, and applicable regional compliance before public launch. `reports.jsonl` must be monitored by an operator and stored safely.
- Self-reported region and gender have **no verification**. A gender preference cannot guarantee someone's actual identity. Users with undisclosed genders aren't included in filtered matches.
- Server state lives in memory: restarting it clears matches, sessions, blocks, and queues. Production scale requires shared state (e.g. Redis), durable identities/bans, horizontal-compatible signaling and metrics.
- No recordings are created by the app. Participants may still use external screen recorders; explicitly disclose privacy expectations.
- WebRTC media is encrypted in transit, but privacy requirements and IP exposure differ from end-to-end relay architectures. Use TURN-only if preventing peers learning each other's public IPs is important, and explain added bandwidth costs.

## Files

`server.js` = matchmaking and signaling backend, static serving, owner authentication. `public/index.html`, `public/styles.css`, `public/app.js` = client interface and WebRTC flow. `scripts/set-owner-password.js` = safe interactive owner setup. `tests/` = automated checks.

## Render pilot deployment (included `render.yaml`)

Render can host the full Node + WebSocket application, unlike static-site hosting. The Blueprint in this ZIP defines a free pilot web service with an HTTPS address and health checks. It derives `PUBLIC_ORIGIN` from its Render assigned URL and prompts for the owner-password hash as a private environment variable. You must first place this folder in a GitHub repository, connect GitHub to Render, and create a new Blueprint using `render.yaml`. The Render connection and GitHub repository creation require your authorization. No public address is assigned until the deployment succeeds.

Free Render instances can sleep after inactivity, drop connections on restarts, and lose local report files. This is **not an acceptable durable production moderation inbox**. Before advertising a public launch, switch to durable report storage, establish a staffed moderation/abuse process and reliable age assurance, provide legal contact information, and configure TURN infrastructure. The bundled `/privacy`, `/terms`, and `/rules` documents are provisional and have explicit operator TODOs; do not represent them as final legal approval. The application is ready for local and private pilot testing; broad public release still needs those operational protections.

A user invite button is shown during matchmaking so early users can share the public link. Partner discovery only includes **voluntary users connected to this service**; live third-party feeds are not available without provider-supported API integration and all participants' consent.

Before launching, set `PUBLIC_ORIGIN` to the actual canonical HTTPS origin if you attach a custom domain. The Blueprint defaults to the Render-assigned `https://...onrender.com` URL. Put the password **hash**, not your actual password, into the `PRIVATE_FILTER_PASSWORD_HASH` secret setting. Configure `TURN_URLS`/`TURN_SHARED_SECRET` together, or leave both unset during limited STUN-only testing. Never commit `.env` or the moderation report file.

If using the included Dockerfile, mount persistent storage at `/app/data`; its report file is otherwise ephemeral. When using a managed Node host, point `REPORTS_FILE` at the operator-protected persistent storage path.

## Private pilot preview gate

Configure `ROAM_PREVIEW_CODE` as a long, random value in Render **Environment**. When set, Roam requires visitors to enter the code before accessing the site, API, or WebSocket. The gate sets an HttpOnly session cookie and prevents indexing. Leave `ROAM_PREVIEW_CODE` unset only after age assurance, moderation, TURN infrastructure, durable abuse reporting and operational safeguards are established. Preview sessions expire after seven days or on server restart. This is a small pilot gate, not a production account system.
