# FilmBox

A Netflix-style home streaming platform built with vanilla HTML/CSS/JS. Pulls movie and TV data from TMDB and links playback through prehraj.to. All per-profile state — profiles, favorites, watchlists, watched history and playback progress — is stored in local JSON files; no external database needed.

## Features

- **Streaming-style UI** — full-bleed hero with cross-fading Ken Burns backdrops, progress dots and an ambient glow tinted from each backdrop; horizontal rows of poster cards with lift/glow/light-sweep on hover or focus; animated modals; dark and light themes
- **TV remote / LG webOS** — D-pad spatial navigation across the whole app (rows, modals, menus), OK/Back keys, Magic Remote pointer support, cheaper effects in TV mode; the code targets webOS 5+ (Chromium 68)
- **Intro animation** — logo entrance with Web Audio sound
- **Multi-profile support** — create, switch and delete profiles; each profile has its own theme and favorites
- **Per-profile favorites** — heart any movie or series; favorites are isolated per profile and saved to JSON
- **Multiple named watchlists** — create, rename and delete several lists per profile; a title can live in any of them; every change is saved to per-profile JSON
- **Watched history** — mark titles as watched (with a watched badge); auto-marked at ~90% progress; isolated per profile and stored in JSON
- **Continue Watching** — a dedicated row of titles you started but haven't finished (under 90%), each card showing a **green progress line** at the exact point where you stopped, the **episode label** (TV) and the **remaining minutes**. Progress is written to the JSON store **every minute while playing** (and on pause/close), so it survives crashes. Each TV episode is tracked **separately** under a composite `tmdbId:S01E05` key instead of colliding on the show id, and each entry carries its own title/poster so the row renders on **any device** without relying on browser storage. Reopening a title shows a **Resume / Start over** prompt, every card has a **✕ remove** button, and finishing a title drops it from the row automatically
- **Theme persistence** — dark/light toggle saved to the profile in the JSON store
- **Hero banner** — rotating trending movies with backdrop, title and description
- **3 browsable rows** — Popular, Trending, Top Rated; genre filters, sort tabs, infinite sideways loading
- **Doporučeno pro vás** — a row built from TMDB recommendations for what the profile recently watched, liked or has in progress (already-seen titles are left out)
- **Procházet** — browse films or series by genre, decade (last 5 years … older) and sort (popular / rating / newest), with "load more"
- **Online subtitles** — optional OpenSubtitles search inside the player (see *Configure*)
- **Next episode during the credits** — a "Další epizoda" card with a countdown in the last 45 s of an episode
- **Search** — live TMDB search with dropdown and search history; <kbd>Enter</kbd> shows a full results grid
- **Detail modal** — backdrop header, poster, genres, cast (with characters), overview, trailer, season/episode browser with episode stills and per-episode progress, similar titles
- **Source picker (prehraj.to)** — only real films/episodes are shown: results must match the title (search text, Czech or original TMDB name), be long enough (films ≥ 40 min, episodes ≥ 8 min), not be clips/trailers/gameplay/music videos, and for episodes carry the right SxxEyy/2x03 code; film searches drop series episodes. "Zobrazit vše" reveals the hidden rest. Results as cards with thumbnail, duration, size, quality and CZ-dub/subtitle tags, filters and a recommended pick; plays in the FilmBox player (quality, HDR fix, subtitles, resume)
- **Trailer modal** — embedded YouTube player
- **Actor modal** — photo, biography and top works
- **Player** — searches prehraj.to for the title; supports custom query if nothing is found; keyboard shortcuts, buffering spinner, **resume prompt**, **subtitles** and **auto-play next episode** for TV; press <kbd>/</kbd> anywhere to jump to search
  - **Settings menu** (gear / <kbd>S</kbd>) — quality (Auto / 1080p / 720p…), subtitle track and size, HDR colour mode and brightness, reload video
  - **HDR fix for TVs** — many "4K" uploads are HDR masters re-encoded to 8-bit H.264 with their HDR colour tags left in, which smart-TV browsers render **purple/green**. The server's `/stream` proxy rewrites those tags to BT.709 in place (same byte length, so seeking works), and the player tone-maps HDR → SDR with WebGL. Modes: *Automaticky* (tone-mapped), *Jednoduché* (tags fixed only — for weak TVs), *Originál* (untouched)
  - **Reliability** — Auto quality follows screen size and steps down on repeated buffering; expired CDN links are refreshed automatically; a broken quality falls back to the next one; stuck streams are reloaded at the same position
  - **TV remote friendly** — arrow/OK navigation in menus and prompts, Samsung/LG back keys, media keys, Media Session
- **Export / wipe my data** — from a profile's settings, download everything (favorites, watched, watchlists, progress) as one JSON file, or wipe the library while keeping the profile
- **Fully responsive** — 360 px phone → tablet → laptop → large TV

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML / CSS / JavaScript |
| Icons | Bootstrap Icons (CDN) |
| Movie data | TMDB API v3 |
| Playback source | prehraj.to (scraping) |
| Backend | Node.js + Express |
| Scraping | JSDOM + Puppeteer |
| Data storage | JSON files (no external DB) |

## Project Structure

```
home_streaming_app/
├── server.js           # Express server — TMDB proxy, profiles/favorites/watched/watchlists/progress API, prehraj.to scraping
├── stream.js           # prehraj.to page parsing, MP4 colour-tag probing, /stream proxy
├── security.js         # API input validation, PIN sessions, wrong-PIN rate limit
├── subtitles.js        # SRT→WebVTT + OpenSubtitles search/download
├── test-unit/          # node:test unit tests (npm run test:unit)
├── db.js               # JSON file store (profiles, favorites, watched, watchlists, progress)
├── package.json
├── data/               # Created automatically on first run
│   ├── profiles.json
│   ├── favorites.json
│   ├── watched.json
│   ├── watchlists.json   # Per-profile array of named lists { id, name, movies[] }
│   └── progress.json     # Per-profile playback position, keyed by tmdbId or "tmdbId:S01E05" → { seconds, duration, title, posterPath, mediaType, tmdbId, episodeLabel }
└── src/
    ├── index.html
    ├── player.html       # Video player (quality, subtitles, HDR fix, remote controls)
    ├── css/
    │   ├── base.css      # Design tokens, buttons, fields, chips, focus rings
    │   ├── navbar.css
    │   ├── hero.css
    │   ├── rows.css      # Content rows + movie cards
    │   ├── modals.css    # Detail sheet, source picker, overlays
    │   ├── profiles.css  # Intro + profile chooser + PIN
    │   ├── settings.css
    │   ├── watchlist.css
    │   ├── footer.css
    │   └── responsive.css # Breakpoints + TV mode
    └── js/
        ├── utils.js      # Helpers, modal stack, confirm dialog, profile helpers
        ├── tv.js         # D-pad spatial navigation, Back key, TV detection
        ├── intro.js      # Intro animation + profile chooser (API-driven)
        ├── favorites.js  # Per-profile favorites with isolated state
        ├── cards.js      # Card builder, rows, catalog filters/sort, infinite loading
        ├── trailer.js    # Trailer modal
        ├── actor.js      # Actor modal
        ├── player.js     # Source picker (prehraj.to search → player)
        ├── relevance.js  # Film/series filter for source results (shared with unit tests)
        ├── hdr-renderer.js # WebGL HDR → SDR tone mapping for the player
        ├── detail.js     # Detail modal + season browser
        ├── search.js     # Live search, history, results grid
        ├── hero.js       # Hero carousel
        ├── recommend.js  # "Doporučeno pro vás" row
        ├── browse.js     # "Procházet" genre / decade browser
        ├── watched.js    # Per-profile watched history + badges
        ├── watchlist.js  # Continue Watching + multi-list management
        ├── settings.js   # Profile settings + PIN prompt
        └── main.js       # Navbar, section links, theme toggle
```

## Getting Started

### Prerequisites

- Node.js 18+
- A free TMDB API key from [themoviedb.org](https://www.themoviedb.org/settings/api)

### Install

```bash
git clone https://github.com/kinkoo777/home_streaming_app.git
cd home_streaming_app
npm install
```

### Configure

The TMDB credential is read from an environment variable — it is **not** stored in the source. Copy the example env file and paste your TMDB **API v4 read access token**:

```bash
cp .env.example .env
```

```ini
# .env
TMDB_READ_TOKEN=your_tmdb_v4_read_access_token_here
```

`.env` is git-ignored. The server refuses to start if `TMDB_READ_TOKEN` is missing.

**Optional — online subtitles.** When a video has no Czech/Slovak subtitles, the player can search [OpenSubtitles.com](https://www.opensubtitles.com). Create a free account, add an API consumer at *Profile → API consumers*, and add:

```ini
OPENSUBTITLES_API_KEY=your_api_key
# optional: log in for a higher daily download quota
OPENSUBTITLES_USERNAME=your_username
OPENSUBTITLES_PASSWORD=your_password
```

Without a key the feature simply stays hidden. Downloaded subtitles are cached in `data/subtitles/`.

### Run

```bash
node server.js
```

Open [http://localhost:3000](http://localhost:3000). The `data/` folder is created automatically on first run. Set `PORT` to use a different port.

On an LG TV, open the same address in the webOS browser.

| Remote | Browsing | Player |
|---|---|---|
| Arrows | Move between titles; ▲▼ jump row to row (remembers your place in each row) | ◀▶ seek — hold to speed up (10 s → 30 s → 60 s); ▲▼ open the control bar |
| OK | Open | Play / pause |
| Back | Close window / back to top | Leave player |
| 🔴 Red | Search | Subtitles on/off |
| 🟢 Green | My list | Settings (quality, subtitles, colours) |
| 🟡 Yellow | Profile settings | — |
| 🔵 Blue | Switch profile | — |

### Test

Unit tests (no server or network needed) cover the HDR colour-tag patching, prehraj.to page parsing, API input validation / PIN limits and the film/series source filter:

```bash
npm run test:unit
```

End-to-end tests (Playwright) run against a running server with a valid TMDB token:

```bash
npx playwright install chromium   # once
npm test                          # or BASE=http://localhost:3100 npm test
```

To access from other devices on the same network use your machine's local IP — e.g. `http://192.168.1.x:3000`.

### Linux

Before running on Linux, install Chromium system dependencies:

```bash
sudo apt-get install -y libgbm1 libasound2 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libpango-1.0-0 libcairo2 libnss3 libnspr4
```

## API Endpoints

**PIN-protected profiles:** every `/api/profiles/:id…` route below (except listing) needs the session token returned by `POST /api/profiles/:id/pin/verify` `{ pin }` → `{ ok, token }`, sent as the `X-Profile-Token` header (or `?t=` for `navigator.sendBeacon`). Tokens live in server memory for 12 h (a restart asks for the PIN again). Wrong PINs are limited to 5 per 5 minutes. All request bodies are validated; unknown fields are dropped.

### Profiles & Favorites

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/profiles` | List all profiles |
| `POST` | `/api/profiles` | Create profile `{ name, theme }` |
| `GET` | `/api/profiles/:id` | Get profile by id |
| `PUT` | `/api/profiles/:id` | Update profile (name, theme, picture data URL, settings) |
| `POST` | `/api/profiles/:id/pin` | Set `{ pin: "1234" }` or clear `{ pin: null }` the PIN → `{ hasPin, token }` |
| `POST` | `/api/profiles/:id/pin/verify` | Check a PIN → `{ ok, token }` (429 after 5 wrong attempts) |
| `DELETE` | `/api/profiles/:id` | Delete profile — cascades to its favorites, watched, watchlists and progress |
| `GET` | `/api/profiles/:id/favorites` | List favorites for a profile |
| `POST` | `/api/profiles/:id/favorites` | Add favorite `{ tmdbId, mediaType, title, posterPath }` |
| `DELETE` | `/api/profiles/:id/favorites/:tmdbId/:mediaType` | Remove a favorite |

### Watched

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/profiles/:id/watched` | List watched titles for a profile |
| `POST` | `/api/profiles/:id/watched` | Mark watched `{ tmdbId, mediaType, title, posterPath }` |
| `DELETE` | `/api/profiles/:id/watched/:tmdbId/:mediaType` | Remove a watched entry |

### Watchlists

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/profiles/:id/watchlists` | Get the profile's named lists |
| `PUT` | `/api/profiles/:id/watchlists` | Replace the profile's lists — body is the full array of `{ id, name, movies[] }` |

### Progress

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/profiles/:id/progress` | Get playback progress map, keyed by `tmdbId` (or `tmdbId:S01E05` per episode) |
| `PUT`/`POST` | `/api/profiles/:id/progress/:key` | Save position + metadata `{ seconds, duration, title, posterPath, mediaType, tmdbId, episodeLabel }` (POST = page-close beacon) |
| `DELETE` | `/api/profiles/:id/progress/:key` | Remove a single Continue Watching entry |

### Data export / wipe

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/profiles/:id/export` | Download the profile + favorites/watched/watchlists/progress as one JSON document |
| `DELETE` | `/api/profiles/:id/data` | Wipe the profile's library (favorites, watched, watchlists, progress); keeps the profile |

### TMDB Proxy

| Endpoint | Description |
|---|---|
| `GET /tmdb/movies?type=popular\|trending\|top_rated&page=N` | Paginated lists |
| `GET /tmdb/search?q=<query>` | Multi-search |
| `GET /tmdb/details?id=&type=movie\|tv` | Details + cast |
| `GET /tmdb/videos?id=&type=` | Trailers |
| `GET /tmdb/similar?id=&type=` | Similar titles |
| `GET /tmdb/actor?id=` | Actor bio + works |
| `GET /tmdb/season?id=&season=N` | TV season episodes |
| `GET /tmdb/hero` | Trending movies for hero banner |
| `GET /tmdb/recommendations?id=&type=` | Recommendations for one title |
| `GET /tmdb/discover?type=movie\|tv&genre=&from=&to=&sort=popular\|rating\|newest&page=` | Browse by genre / year range |
| `GET /tmdb/genres?type=movie\|tv` | Genre list |

### Subtitles (OpenSubtitles, optional)

| Endpoint | Description |
|---|---|
| `GET /subs/status` | `{ enabled }` — whether an API key is configured |
| `GET /subs/search?tmdbId=&type=movie\|tv&season=&episode=` | Czech/Slovak subtitles → `[{ fileId, lang, release, downloads, hearingImpaired }]` |
| `GET /subs/file/:fileId` | The subtitle as WebVTT (cached on disk) |

### Playback (prehraj.to)

| Endpoint | Description |
|---|---|
| `GET /search?q=<query>` | Title search |
| `GET /get_video?url=<url>` | Read the video page → `{ name, duration, pageUrl, qualities: [{ src, label, res, hdr, transfer }], subtitles: [{ src, label, lang, default }] }` (Puppeteer fallback) |
| `GET /stream?url=<cdn url>` | Range-aware video proxy that rewrites HDR colour tags to BT.709 (used for HDR-tagged files) |
| `GET /get_subtitle?url=<url>` | Proxy + normalize a subtitle file to WebVTT (SRT auto-converted) |

TMDB and search responses are cached for 5 minutes (in memory and in `data/tmdb-cache.json`, so they survive restarts). The headless browser used as a fallback for `/get_video` starts on first use, restarts if it crashes, runs at most 2 tabs and closes after 10 minutes idle.

## Browser Support

Any modern browser (Chrome, Edge, Firefox, Safari) and TV browsers from LG webOS 5 (Chromium 68) up. Front-end code is plain ES2018 without optional chaining, and the CSS avoids features newer than Chromium 68 (flexbox `gap`, `inset`, `clamp()`, `:focus-visible`).
