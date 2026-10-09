# Roam Organic Launch Plan (v1.2)

The problem is **user concurrency**, not the WebRTC protocol. No third-party stranger-chat site has granted permission to share its live queue, so do not scrape or automate other sites, buy bot traffic, or imply matches where none exist.

## Product features implemented

- Public `/share` page with permission-based invite links and a partner website link/widget (outbound link, not embedded camera access).
- Native Share API / copy-link fallback on the homepage and while waiting for a match.
- Real online/searching counts from authenticated-as-adult WebSocket sessions; not fake audience figures.
- Optional regional-search relaxation after 30 seconds; anyone choosing a specific region can opt out.
- Search engine sitemap now includes `/share` and canonical URLs.
- Regression tests for the new matching behavior and growth endpoints.

## First 7 days: focus traffic instead of scattering it

1. Arrange **three preannounced gathering windows** over 7 days. Suggest 30-45 minutes each. Invite actual adults via your own contacts and creators who agree to share. Ask everyone to join the same window; aim for 20 people online simultaneously. A timed event cannot guarantee strangers will be available.
2. Post a **consent-based demo** using yourself and an invited collaborator (not a recorded stranger without consent) to YouTube Shorts, TikTok and Instagram Reels. Link directly to `https://roam-video-chat.onrender.com/share`. Content hooks: free adult video chats, worldwide region selection, ability to skip/block/report.
3. Share in places that expressly permit promotion: personal profiles, your own existing audience, maker/product launch communities, Product Hunt. Reddit communities set their own rules; don't post repeatedly or send unsolicited mass DMs.
4. Ask small community owners whether they'd like to add the `/share` page's website link to their page. Only connect voluntary traffic, not other platforms' existing matchmaking feeds.
5. Collect real metrics via a first-party privacy-respecting analytics provider once connected: unique landing visits, start button rate, queue-to-connection rate, median search time, returning users, invitation URL sources, moderation report handling. Never invent these numbers.

## Before running paid promotions or broad viral campaigns

- Set up a TURN service and test cross-network calls (mobile cellular vs home Wi-Fi).
- Move reports and bans to durable storage, establish moderation procedures, and address minors and sexual abuse risks.
- Replace free-tier cold starts with an always-on hosting plan if demand warrants, with spending explicitly approved.
- Get Google Search Console ownership verified and submit `/sitemap.xml`; discovery does not guarantee ranking.

## Disclaimers

Invite links lead to the global matchmaking pool, not guaranteed friend-to-friend pairing. Online counts only include actual connected, initialized sessions; they are not projections. Server-side analytics are not persistently stored by this release.
