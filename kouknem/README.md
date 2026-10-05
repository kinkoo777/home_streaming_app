# Kouknem

**Watch films together with friends, anywhere.** Open a room, send the link, and everyone watches the same moment, with chat, emoji reactions and a vote on what to play. Friends don't need an account or an app.

Kouknem is the watch-together feature ("Sledovat společně") of FilmBox, pulled out into a standalone public service. It has a landing page and a copyright / notice-and-action policy with a working reporting process.

## What's inside

| Path | What it does |
|---|---|
| `server.js` | The one public server: landing page, rooms, policy pages, notice API |
| `lib/rooms.js` | Rooms: roles and permissions, synced playback, chat, reactions, voting on films (Server-Sent Events, in memory) |
| `lib/sources.js` | Looks up film metadata on TMDB and finds and resolves uploads on third-party video sites for the film a room picked |
| `lib/stream.js` | Reads video pages and runs the range-aware stream proxy (also fixes HDR colour tags) |
| `lib/relevance.js` | Keeps only uploads that really are the chosen film and ranks them by the host's preferences |
| `lib/notices.js` | Notice-and-action: validates and stores notices, keeps the URL blocklist |
| `tools/admin.js` | CLI for handling notices and blocking or unblocking URLs |
| `views/` | Landing page (Czech), the policy and the report form (English), and the 404 page. Operator details are filled in from `.env` |
| `public/` | Room page (`/r/<id>`), CSS, JS and icons |

## Run

```bash
cd kouknem
cp .env.example .env        # fill in TMDB_READ_TOKEN, PUBLIC_URL and the operator details
npm install
npm start                   # http://localhost:3000
npm test                    # unit + API tests; needs no network or TMDB token
```

Put it behind HTTPS (Caddy, nginx or a Cloudflare Tunnel) and set `PUBLIC_URL` so room links use the public address. `TRUST_PROXY` must match your proxy, or the per-IP rate limits will treat all visitors as one.

## How a room works

1. Someone on the landing page enters a name and clicks **Založit místnost**. They become the host of a new room (`POST /api/rooms`).
2. They share the link `/r/<id>`. The random id is the invitation. Friends type a name and join.
3. Everyone searches films (TMDB) and proposes them, then votes. The host, or anyone allowed to control playback, starts the winner. They can pick a specific upload or let Kouknem use the recommended one.
4. Play, pause and seek apply to everyone, and drift is corrected all the time. Each person keeps their own volume, quality and subtitles.

Limits: 20 people per room and 20 films per vote. By default there are at most 200 rooms open at once (`KOUKNEM_MAX_ROOMS`) and each IP address can open 5 new rooms per 10 minutes (`KOUKNEM_ROOMS_PER_IP`). A room closes after 12 h, or after 30 min with nobody connected. Nothing about a room is stored on disk.

**Bandwidth:** video plays straight from the third-party site when the browser allows it. Otherwise it goes through this server's `/api/rooms/<id>/stream/<n>` proxy, which costs about 5–8 Mbit/s per viewer in 1080p. Size the server for that.

## Notice-and-action

The policy at `/copyright` is the *Copyright, Notice-and-Action & Intermediary Services Policy* with Kouknem as the service name. The code does what the policy promises:

- **Reporting:** `/copyright/report` collects the eight items from section 3 (also accepted by email). Each notice is appended to `data/notices.jsonl` with a reference such as `KN-20261105-1A2B3C4D`. No IP addresses are stored.
- **Decisions are made by a person:**
  ```bash
  npm run admin -- notices                     # open notices
  npm run admin -- show KN-…                   # one notice in full
  npm run admin -- action KN-… "note"          # block every URL in it, mark it actioned
  npm run admin -- status KN-… needs-info "asked for the exact URL"
  npm run admin -- block https://… --notice KN-…
  npm run admin -- unblock https://…
  npm run admin -- blocked
  ```
- **Re-indexing prevention:** blocked URLs go in `data/blocked.json`. They never show up in a room's source list again, can't be picked or refreshed, and any room playing one stops it within about 5 seconds. A room can only play uploads from the server-side source list; no endpoint accepts a video URL from a client, so the blocklist covers everything.
- Keep `data/` backed up. It is the record you may need for legal or compliance purposes.

## Before going live

- Fill in the operator details in `.env`. Until you do, the policy and footer show `[to be completed: …]` rather than made-up values.
- The policy mentions **Terms of Service**, and the service handles personal data (names in rooms, notifier contact details). A Terms of Service page and a GDPR privacy policy are **not** included yet.
- Have a lawyer review the policy against how the service actually works. The policy itself notes that whether liability limits apply depends on how the service operates in practice. Here, Kouknem searches third-party sites itself and can relay video through its own server, which goes beyond plain linking.
- The `copyright@` mailbox in `.env` must exist and be monitored.
