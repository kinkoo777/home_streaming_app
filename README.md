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
- **Per-episode watch state** — each episode in the detail view shows *Zhlédnuto* (watched), a progress bar with minutes left, or *Další na řadě* (next up); a season summary ("Zhlédnuto 3 z 10" + Pokračovat) and ✓ on fully watched seasons; episodes can be marked watched/unwatched by hand. Finished episodes stay in the progress store flagged `finished` (Continue Watching skips them)
- **What's new video** — the first time each profile is opened after an update, a short full-screen video shows the new features (Skip button, TV Back key; falls back to muted with a *Zapnout zvuk* button if the browser blocks sound). Seen state is stored per profile on the server, so it plays once per profile, not per device
- **Film series & watch guides** — a *Filmové série* row with hand-made guides (MCU, Star Wars, Wizarding World, Fast & Furious, Alien) and popular TMDB collections, each card showing "Viděno X z N". A guide opens a sheet with a **Podle vydání / Chronologicky** order toggle (remembered per guide), numbered films, ✓ marks, *Další na řadě* and a *Pokračovat* button. A film's detail shows **Součást série** with the whole collection in order, your progress and links to the full series/guide
- **Next episode during the credits** — a "Další epizoda" card with a countdown in the last 45 s of an episode. After a season's last episode it continues with the next season's first; after the last episode of the show (or the newest one aired) it says so — *To byl poslední díl seriálu* / *Další díl vyjde 12. 10.* — instead of searching for an episode that doesn't exist
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
- **Sledovat společně** — watch with friends anywhere by sending a link: *Společně* in the player opens a room for what you're watching, at the same second. Everyone in the room sees the same picture at the same moment (play, pause and seeks apply to all, drift is corrected continuously), with **chat**, **emoji reactions** floating over the video and a **who's watching** list (incl. who's buffering). **Roles and permissions**: you're the host; others join as *Divák* or *Moderátor* and you tick what each role may do — control playback, chat, react, remove people — change anyone's role, remove people, lock the room or end it. Friends only need the link and a name (no FilmBox profile); they reach a separate, minimal guest server that offers nothing but the room. The host can switch the room to the next episode; the host's progress and watched time are saved as usual. **Choosing together:** a room can also start without a film (*people* button in the navbar) — everyone searches films and proposes them, **votes** (one vote each, changeable; proposing counts as your vote), and the host — or anyone allowed to control playback — starts the winner (or any proposal) — first choosing **which upload** to play from a list (quality, CZ dub, subtitles, size, length, site; filters; the best one by the host's playback preferences marked *Doporučeno*), or just *Pustit doporučený*. Mid-film, *Jiný zdroj videa…* in the gear menu switches everyone to another upload at the same position. During a film the *Výběr* tab collects proposals for the next one, and *Jiný film* takes the room back to choosing
- **Pustit na TV** — pick a film or episode on your phone and play it on the TV: the cast button in the navbar lists every TV with FilmBox open, *Přehrát* then sends the video there (your phone asks *Pokračovat od 12:34 / Od začátku*), plays as your profile (PIN profiles included) and turns the phone into a remote — play/pause, ±10/30 s, tap the timeline to jump, subtitles, next episode, stop. Any device can be a receiver: TVs are automatically, other browsers after opening FilmBox once with `?receiver=1`. Already watching on the phone? *Na TV* in the player hands the video over to the TV at the same second and the phone switches to the remote
- **Nové díly** — a row with the series you follow (episodes in progress, series marked watched, favourite series) that aired episodes you haven't seen: "Nový díl S02E05", "3 nové díly", "Nová řada", plus the date of the next one
- **Brzy vyjde + calendar** — a row and a month-by-month calendar of what's coming from your lists and favourites: Czech cinema and digital premieres (US when there's no Czech date), series premieres and the next episodes of followed series
- **Co pustit?** — the shuffle button in the navbar picks something at random from your lists and recommendations (or this week's trending titles for a new profile), filtered by films/series, genre and length (up to 1 h 40 / 2 h); *Jiný tip* rerolls without repeating itself
- **Playback preferences per profile** — *Nastavení → Přehrávání*: which uploads the source picker recommends and focuses first (CZ dub / original with subtitles / doesn't matter; 4K / 1080p / 720p), which subtitles start on (as last time / off / Czech / Slovak / English), the same ranking for the next episode that plays automatically
- **Sledujete ještě?** — after three episodes in a row that started on their own with nobody touching the remote, the player stops and asks instead of counting down to the next one (can be turned off per profile)
- **Sleep timer** — *Settings (gear) → Časovač vypnutí* in the player: at the end of this episode / film or after 15–90 minutes the video pauses (position saved) behind a black "Dobrou noc" screen; survives the jump to the next episode
- **Skip intro** — mark a series' opening once in the player (*Settings → Úvod seriálu*: "Začátek úvodu je teď", "Konec úvodu je teď"); every episode of that season — and of seasons nobody has marked yet — then shows *Přeskočit úvod*. Marks are shared by all profiles
- **Watching stats** — *Nastavení → Statistiky*: hours watched this month / year / in total (films vs. series), finished films and episodes, days with watching and the longest run of days, the last 12 months as columns, top genres and the most watched titles. Time is counted from playback the player reports (only real playing, never seeking); finished titles include older history
- **Automatic source fallback** — when an upload stops working (deleted, blocked, keeps failing even with fresh links) the player moves on to the next one at the same second; once the backups that came from the source picker are used up it asks the server for the rest of that film's / episode's uploads (best first by the profile's playback preferences). Rooms do the same for everyone: the server switches the room when the upload's page is gone, or when fresh links still don't play for someone allowed to control playback or for two people (one guest's bad connection alone doesn't switch the film); the chat says *Zdroj přestal fungovat — přepnuto na jiný*
- **Playback speed** — *Settings (gear) → Rychlost* in the player: 0,5× – 2×, or <kbd>&lt;</kbd> / <kbd>&gt;</kbd>; kept for the session, so the next episode plays at the same speed
- **Server page** — *Nastavení → Server a aktualizace*: which version runs, the changes waiting on GitHub and **Aktualizovat a restartovat** (git pull → `npm ci` when the dependencies changed → restart; the page waits for the server and reloads), plus uptime, free disk space, memory, CPU temperature, open rooms, Funnel and the last errors. A red dot on the button means an update is waiting. See *Updating*
- **Trailer previews** — like Netflix: 2.5 s after a hero slide appears its trailer fades in behind the text (muted; 🔇/🔊 button; the carousel waits until it ends; paused when you scroll away, open a window or hover a card). With a mouse, resting on a card for 0.7 s pops out a bigger preview with the trailer, rating, year, genres and *Přehrát* / *Můj seznam* / *Detail*. Czech trailers first, English when there's none (also in the trailer window). Off on TVs, with *Omezit animace*, with data saving, or per profile (*Nastavení → Přehrávat ukázky při procházení*)
- **👎 / 👍 / 👍👍 ratings** — *Nelíbí se mi / Líbí se mi / Miluju to* in the detail, in the card pop-out (👍 opens the three choices) and at the end of a film (or after a series' last episode: *Jak se vám film líbil?*). Pressing the same one again takes it back. 👎 titles never appear in recommendations or *Co pustit?*; 👍 ones become seeds for them. Saved per profile (`data/ratings.json`, in the export, wiped with the data)
- **% shoda** — "98 % shoda" in the detail and the card pop-out: how well a title's genres fit the profile's taste (built from ratings, favourites, watched and started titles — a dislike weighs most) plus its TMDB rating. Shown once the profile has rated / watched at least 3 titles; green from 80 %
- **Protože se vám líbilo / Protože jste sledovali „X“** — up to two extra rows under *Doporučeno pro vás*, each built from one title: the latest 👍 and the latest finished one (only when they bring at least 6 titles not already on screen)
- **ČSFD rating** — the detail shows the ČSFD score next to TMDB's (red / blue / grey like ČSFD, a link to the film there). Looked up by the Czech title (then the original one) and the year, cached for a week
- **Kde jinde to běží** — in the detail: which streaming services have the title in Czechia, in the subscription, free, to rent or to buy (TMDB / JustWatch data, linked)
- **Kids profiles** — *Dětský profil* when creating a profile or in its settings: only animated, family and kids titles everywhere (rows, hero, search, recommendations, browsing — no horror, thriller, crime or war; a grown-up title's detail is refused), no source search, rooms, server page or data wiping, and an orange *Děti* badge. With a household **rodičovský PIN** (*Nastavení → Rodičovský PIN*) a kids profile can only be left — or switched off — with that PIN
- **New-episode notifications** — *Nastavení → Upozornění na nové díly*: pick a topic (*Vymyslet téma*), subscribe to it in the free **ntfy** app (Android / iPhone, no account) and the phone gets "Nový díl: Hra o trůny S02E05" when a series the profile follows (episodes in progress / watched, watched or favourite series) airs an episode it hasn't seen. Checked every hour, each episode once; *Poslat zkoušku* to try it
- **Voice search** — a 🎤 in the search bar where the browser supports speech recognition (Chrome, Edge, Android, Safari): speak a title in Czech and it searches as you talk
- **Automatic intro & credits detection** — when a season has no *Přeskočit úvod* mark yet, the server compares the audio of the playing episode with the next one (ffmpeg, first 8 min + last 4 min, lowest quality) and saves the shared opening as the season's mark and where the end credits start; *Další epizoda* then appears as the credits begin. A mark set by hand is never overwritten. Needs `ffmpeg` on the server (`sudo apt install ffmpeg`); off with `FILMBOX_AUTO_INTRO=0`
- **Keep on the Pi** — *Settings (gear) → Stáhnout do FilmBoxu* in the player saves the film / episode on the server (with subtitles, HDR colours already fixed). From then on it plays from there — instantly, without buffering, even after the upload disappears — and appears in the *Uloženo ve FilmBoxu* row. One download at a time, resumes after a restart or an expired link, stops before the disk gets full; the Server page lists them with progress and *Smazat*
- **Pause screen** — paused for 8 s with nobody touching anything, the player shows what you're watching over the dimmed picture: title, episode and its name, year, rating, length, genres, the episode's (or film's) overview and the cast. Any key, touch or mouse move hides it
- **Timeline thumbnails** — hovering or dragging the timeline shows the picture at that moment with its time (a muted copy of the lowest quality jumps there; the film itself doesn't move). Not on TVs
- **Ambilight** — the picture's colours glow into the black bars around it (wide films, other screen shapes); *Settings (gear) → Ambilight*, remembered per device, off by default on TVs
- **Install as an app** — on https (or localhost) FilmBox installs to the phone home screen / desktop like an app, opens faster and keeps posters cached; see *Install as an app*
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
├── cache.js            # Response cache (TMDB 30 min for lists, 6 h for details), kept on disk
├── stats.js            # Watching stats from the watch history (hours, finished titles, months, streaks)
├── cast.js             # "Pustit na TV": TV receivers (Server-Sent Events), commands, playback state
├── rooms.js            # "Sledovat společně": rooms, roles + permissions, sync, chat, reactions, source fallback (Server-Sent Events)
├── admin.js            # Server page: version, updates from GitHub (pull + restart), health, recent errors
├── csfd.js             # ČSFD rating lookup (search page → film page, JSON-LD / rating box)
├── kids.js             # Kids profiles: children's-titles filter for /tmdb/*
├── notify.js           # New-episode notifications via ntfy
├── introdetect.js      # Automatic intro + credits detection (ffmpeg + audio fingerprints)
├── downloads.js        # Keep on the Pi: downloads with resume, HDR fix, subtitles
├── subtitles.js        # SRT→WebVTT + OpenSubtitles search/download
├── tools/
│   ├── guides.spec.js  # Hand-written watch guides (film lists, chronological order) + TMDB collection ids
│   └── build-guides.js # Resolves them on TMDB → src/guides/guides.json
├── test-unit/          # node:test unit tests (npm run test:unit)
├── db.js               # JSON file store (profiles, favorites, watched, watchlists, progress, history, intros)
├── package.json
├── data/               # Created automatically on first run
│   ├── profiles.json
│   ├── favorites.json
│   ├── watched.json
│   ├── watchlists.json   # Per-profile array of named lists { id, name, movies[] }
│   ├── progress.json     # Per-profile playback position, keyed by tmdbId or "tmdbId:S01E05" → { seconds, duration, title, posterPath, mediaType, tmdbId, episodeLabel }
│   ├── history.json      # Seconds played per profile, day and title (stats)
│   ├── ratings.json      # 👎 / 👍 / 👍👍 per profile and title
│   ├── household.json    # Parent PIN (bcrypt) for kids profiles
│   ├── notified.json     # Episodes already announced per profile (ntfy)
│   ├── downloads.json    # Saved films / episodes; the files are in data/downloads/
│   └── intros.json       # Skip-intro marks per series + season, shared by all profiles
└── src/
    ├── index.html
    ├── sw.js             # Service worker: installable app, app shell + TMDB images cache
    ├── media/whats-new.mp4 # "What's new" video (not in git — copy it in manually)
    ├── guides/guides.json # Generated watch guides + collections (node tools/build-guides.js)
    ├── player.html       # Video player (quality, subtitles, HDR fix, remote controls)
    ├── watch.html        # "Sledovat společně" room page (js/watch.js, css/watch.css) — also served by the guest server
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
    │   ├── features.css  # Stats, Nové díly / Brzy vyjde, calendar, Co pustit?, cast + remote
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
        ├── upcoming.js   # "Nové díly" + "Brzy vyjde" rows and the release calendar
        ├── random.js     # "Co pustit?" random pick
        ├── profile-stats.js # Watching stats sheet
        ├── server-admin.js # Server page (version, updates, health)
        ├── previews.js   # Muted trailer previews: hero + card pop-out (YouTube iframe messages)
        ├── ratings.js    # 👎 / 👍 / 👍👍, taste, "% shoda", dislike filter
        ├── taste.js      # Taste profile + match percentage (shared with the server and unit tests)
        ├── voice.js      # Voice search (Web Speech API)
        ├── saved.js      # "Uloženo ve FilmBoxu" row
        ├── episodes.js   # Which episode comes next (next season after a finale; shared with unit tests)
        ├── cast-receiver.js # TV side of "Pustit na TV" (home page + player)
        ├── cast-sender.js   # Phone side: choose a TV, send, remote
        ├── browse.js     # "Procházet" genre / decade browser
        ├── whatsnew.js   # One-time "what's new" video after choosing a profile
        ├── series.js     # "Filmové série" row, watch-guide sheet, "Součást série" in the detail
        ├── watched.js    # Per-profile watched history + badges
        ├── watchlist.js  # Continue Watching + multi-list management
        ├── settings.js   # Profile settings + PIN prompt
        └── main.js       # Navbar, section links, theme toggle
```

## Getting Started

### Prerequisites

- Node.js 20.19+ (22 LTS recommended)
- A free TMDB API key from [themoviedb.org](https://www.themoviedb.org/settings/api)

### Install

```bash
git clone https://github.com/kinkoo777/home_streaming_app.git
cd home_streaming_app
npm install
```

The server uses a headless Chrome for prehraj.to. On Linux it picks up a system `chromium` / `google-chrome` automatically; elsewhere (or without one) download puppeteer's Chrome once — newer npm versions no longer run that step during `npm install`:

```bash
npx puppeteer browsers install chrome
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

**Optional — everything else** (all have sensible defaults):

```ini
# Automatic intro / credits detection needs ffmpeg:  sudo apt install ffmpeg
FILMBOX_AUTO_INTRO=0             # turn it off
# Keep on the Pi
FILMBOX_DOWNLOAD_DIR=/mnt/usb/filmbox   # where saved videos go (default data/downloads)
FILMBOX_DOWNLOAD_MIN_FREE_GB=2          # never fill the disk beyond this
# New-episode notifications
NTFY_SERVER=https://ntfy.sh      # or your own ntfy server
FILMBOX_URL=https://…            # opened when a notification is tapped
FILMBOX_NOTIFY=0                 # turn the hourly check off
FILMBOX_ALLOW_UPDATE=0           # hide "Aktualizovat" on the Server page
```

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

### Updating

*Nastavení → Server a aktualizace* shows the changes waiting on GitHub; **Aktualizovat a restartovat** pulls them (`git pull --ff-only` on the branch the server runs from), runs `npm ci --omit=dev` only when `package.json` / `package-lock.json` changed, and restarts FilmBox. How it comes back depends on how it was started:

| Started with | After the update |
|---|---|
| systemd service | exits with code 75 — the service needs `Restart=on-failure` (or `always`) |
| pm2 | exits, pm2 starts it again |
| Docker | exits with code 75 — needs a restart policy |
| a terminal / `nohup node server.js` | starts its own replacement (output in `filmbox.log`), which waits until the port is free |

If the server has hand-edited files, `git pull` refuses and the page shows the error — sort it out in a terminal (`git status`). Set `FILMBOX_ALLOW_UPDATE=0` to hide the button (the page still shows the version and health). By hand it's still `git pull && npm ci --omit=dev` (when dependencies changed) and a restart.

### Install as an app

Browsers only allow installing (and the offline cache) on `https://` or `localhost`. At home over plain `http://192.168…:3000` FilmBox works as before, just without the install option. To get https inside your tailnet only (not public), let Tailscale serve the main port on another https port — the Funnel for rooms keeps 443:

```bash
sudo tailscale serve --bg --https=8443 3000
```

Then open `https://<your-pi>.<tailnet>.ts.net:8443` on the phone and choose *Add to Home screen* / *Install app*.

### What's new video

Put the video at `src/media/whats-new.mp4` (H.264 MP4; it is git-ignored because of its size). Without the file the feature simply stays off. To show a new video to everyone again, replace the file and bump `VERSION` in `src/js/whatsnew.js`.

### Watch guides

The guides and the collection list live in `tools/guides.spec.js`. After editing it (a new film came out, another franchise), regenerate the data file — it needs `TMDB_READ_TOKEN` in `.env`; unreleased films are skipped automatically:

```bash
node tools/build-guides.js
```

### Test

Unit tests (no TMDB token or network needed) cover the HDR colour-tag patching, prehraj.to page parsing, API input validation / PIN limits, the film/series source filter and source ranking by preferences, the response cache, the stats maths, and — on a throwaway server with a temp data folder — the progress API (saving, page-close beacons, PIN-protected profiles, requests from other websites), playback preferences, skip-intro marks, watched time → stats, casting (receiver ownership, remote commands, link and PIN checks on *play*), choosing a film together (proposals, one-vote rule, permissions, starting the chosen film — with fake TMDB / source finding), and watch-together rooms (what the guest server exposes — and doesn't, joining, sync, chat/reaction limits, roles and permissions, kicking, locking, video changes, room-only video/subtitle proxies):

```bash
npm run test:unit
```

End-to-end tests (Playwright) run against a running server with a valid TMDB token:

```bash
npx playwright install chromium   # once
npm test                          # or BASE=http://localhost:3100 npm test
```

To access from other devices on the same network use your machine's local IP — e.g. `http://192.168.1.x:3000`.

The API only accepts changes from FilmBox's own pages: another website open on the same network can't edit or delete profiles.

### Sledovat společně (watch with friends)

FilmBox runs a second, small **guest server** next to the main one (port `PORT + 1`, i.e. 3001; set `GUEST_PORT`, or `GUEST_PORT=0` to turn it off). It serves only the room page, its own CSS/JS and the room API for joining — no profiles, library, search or anything else — and a room's video and subtitles only to people in that room. **Only this port should ever be reachable from the internet; keep 3000 at home.**

Without anything else, room links work for people on your home Wi-Fi or your Tailscale network. For friends anywhere, publish the guest port — with Tailscale (already on the Pi) that's **Funnel**:

```bash
sudo tailscale funnel --bg 3001     # prints https://<pi-name>.<tailnet>.ts.net
```

The first time, Tailscale may ask you to allow HTTPS / Funnel for your tailnet — follow the link it prints. That's it: FilmBox notices the Funnel by itself (it checks `tailscale serve status` every 30 s) and room links switch to the public address — also in rooms that are already open. If that doesn't work on your system (e.g. the service user can't run `tailscale`), set the address in `.env` and restart FilmBox; `https://` is optional:

```ini
PUBLIC_URL=https://<pi-name>.<tailnet>.ts.net
```

(`sudo tailscale funnel reset` takes it offline again. A Cloudflare Tunnel to `http://localhost:3001` works the same way.)

In the player press **Společně** (or *Settings → Sledovat společně*) to watch what's playing together, or press the **people button** in the navbar to open a room without a film and choose one together. Then **Pozvat** copies or shares the link. Notes:

- The link is the invitation — anyone who has it can join until you **lock** the room (*Oprávnění*) or end it. Rooms live in memory: restarting the server ends them; they also close after 30 min with nobody connected, or after 12 h.
- Video plays straight from the video site where possible; if a friend's browser can't, it goes through the guest server — then it uses your home upload (≈ 5–8 Mbit/s per person in 1080p, 720p is picked on phones).
- Up to 20 people per room, 20 rooms at once, 20 films in a vote. Chat, reactions, joining, film search and votes are rate-limited.
- Film search in a room uses TMDB through FilmBox (members only); the guest server still offers nothing else. Who may propose films is a permission like the others (*Navrhovat filmy*); voting is open to everyone in the room. Listing uploads and starting a film can take ~10–30 s; if the chosen upload doesn't work, the room is told and nothing changes. Only uploads FilmBox itself listed for that film can be picked.
- Volume and quality are each person's own (the slider and the gear in the room); only play, pause and position are shared. Someone on a slow connection catches up with one jump (aimed ahead by how long jumps take there) and small speed changes, and waits a moment if it lands ahead.

### Pustit na TV

Open FilmBox on the TV (the LG app or the TV browser) — it registers itself as a receiver automatically. A computer connected to the TV can be one too: open FilmBox there once with `?receiver=1` (`?receiver=0` turns it off). On the phone, the cast button appears in the navbar as soon as a TV is online; choose the TV there, then press *Přehrát* as usual. If the TV's browser refuses to start a video with sound on its own, it starts muted and the first OK press on the TV remote turns the sound on (the phone remote says so).

### TV diagnostics

Script and playback errors from TVs always end up in the server log (`[client …]` lines). For a detailed trace (remote keys, focus moves, scrolling, playback events), open the app once with `?debug` — e.g. change the launcher address in `webos/index.html` to `?tv=1&debug` — and it stays on for that device until it is opened with `?debug=0`.

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

### Ratings & taste

| Endpoint | Description |
|---|---|
| `GET /api/profiles/:id/ratings` | The profile's ratings, newest first: `[{ tmdbId, mediaType, rating: -1\|1\|2, title, posterPath, ratedAt }]` |
| `PUT /api/profiles/:id/ratings/:mediaType/:tmdbId` | `{ rating: -1\|0\|1\|2, title, posterPath }` — 0 removes it |
| `GET /api/profiles/:id/taste` | `{ genres: { [genreId]: -1…1 }, disliked, liked, n }` from ratings, favourites, watched, in progress (rebuilt at most every 10 min or after a rating) |
| `GET /api/csfd?title=&original=&year=` | ČSFD rating `{ rating, votes, url }` or `{ rating: null }` |
| `GET /tmdb/providers?id=&type=` | Streaming services in Czechia `{ link, flatrate, free, ads, rent, buy }` |

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
| `GET /tmdb/collection?id=` | Film series (TMDB collection) with its parts |

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
| `GET /api/sources?id=&type=movie\|tv[&season=&episode=][&audio=&quality=]` | This film's / episode's uploads, best first (the player's extra backups) |

### Kids, notifications, intros, downloads

| Endpoint | Description |
|---|---|
| `GET /api/household` | `{ parentPin: bool }` |
| `PUT /api/household/parent-pin` | `{ pin: '1234' \| null, currentPin }` — set / change / remove |
| `POST /api/household/parent-pin/verify` | `{ pin }` → `{ ok }` (5 wrong tries per 5 min) |
| `PUT /api/profiles/:id` `{ kids: false, parentPin }` | Leaving kids mode needs the parent PIN when one is set |
| `/tmdb/*?kids=1` | Children's titles only (added by the page for kids profiles) |
| `POST /api/profiles/:id/notify/test` | Test notification to the profile's ntfy topic |
| `POST /api/intros/:tmdbId/:season/detect` | `{ episode, src }` → 202, detection queued (`GET` the same path for its status) |
| `GET /api/downloads` | `{ items, free }` |
| `GET /api/downloads/find?key=movie:603\|tv:1399:S01E02` | The saved copy of a title, if any |
| `POST /api/downloads` | `{ player, src }` → queued download |
| `POST /api/downloads/:id/retry`, `DELETE /api/downloads/:id` | Retry a failed one / delete the copy |
| `GET /downloads/:id/video`, `GET /downloads/:id/sub/:n` | The saved video (ranges) and its subtitles |

### Server page

| Endpoint | Description |
|---|---|
| `GET /api/admin/status` | Version (commit, date, subject, branch), uptime, memory, disk, CPU temperature, rooms, Funnel, last 30 errors |
| `GET /api/admin/updates` | Changes on GitHub not yet on the server (`git fetch`, at most once a minute) |
| `POST /api/admin/update` | Pull, install if needed, restart (202; `GET /api/admin/update` shows the step) — off with `FILMBOX_ALLOW_UPDATE=0` |

TMDB and search responses are cached for 5 minutes (in memory and in `data/tmdb-cache.json`, so they survive restarts). The headless browser used as a fallback for `/get_video` starts on first use, restarts if it crashes, runs at most 2 tabs and closes after 10 minutes idle.

## Browser Support

Any modern browser (Chrome, Edge, Firefox, Safari) and TV browsers from LG webOS 5 (Chromium 68) up. Front-end code is plain ES2018 without optional chaining, and the CSS avoids features newer than Chromium 68 (flexbox `gap`, `inset`, `clamp()`, `:focus-visible`).
