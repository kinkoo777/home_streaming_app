# FilmBox

A Netflix-style home streaming platform built with vanilla HTML/CSS/JS. Pulls movie and TV data from TMDB and links playback through prehraj.to. Profiles and favorites are stored in local JSON files — no external database needed.

## Features

- **Intro animation** — logo entrance with Web Audio sound
- **Multi-profile support** — create, switch and delete profiles; each profile has its own theme and favorites
- **Per-profile favorites** — heart any movie or series; favorites are isolated per profile
- **Theme persistence** — dark/light toggle saved to the profile in the JSON store
- **Hero banner** — rotating trending movies with backdrop, title and description
- **3 browsable grids** — Most Visited, Trending, Top Rated; genre filters, sort tabs, load-more
- **Search** — live TMDB search with dropdown and search history
- **Detail modal** — poster, genres, cast, overview, trailer, season/episode browser for TV, similar titles
- **Trailer modal** — embedded YouTube player
- **Actor modal** — photo, biography and top works
- **Player** — searches prehraj.to for the title; supports custom query if nothing is found
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
├── server.js           # Express server — TMDB proxy, profiles/favorites API, prehraj.to scraping
├── db.js               # JSON file store (data/profiles.json + data/favorites.json)
├── package.json
├── data/               # Created automatically on first run
│   ├── profiles.json
│   └── favorites.json
└── src/
    ├── index.html
    ├── css/
    │   ├── base.css
    │   ├── navbar.css
    │   ├── hero.css
    │   ├── cards.css
    │   ├── grid.css
    │   ├── modals.css
    │   ├── responsive.css
    │   └── intro.css
    └── js/
        ├── intro.js      # Intro animation + profile chooser (API-driven)
        ├── favorites.js  # Per-profile favorites with isolated state
        ├── utils.js      # Toast, skeletons, genre map, shared data map
        ├── cards.js      # Movie cards, grid state, filters, fetch
        ├── trailer.js    # Trailer modal
        ├── actor.js      # Actor modal
        ├── player.js     # prehraj.to search + video modal
        ├── detail.js     # Detail modal + season browser
        ├── search.js     # Live search + theme toggle
        ├── hero.js       # Hero banner rotation
        └── main.js       # Navbar scroll links
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

Open `server.js` and set your TMDB API key at the top:

```js
const TMDB_API_KEY = "your_key_here";
```

### Run

```bash
node server.js
```

Open [http://localhost:3000](http://localhost:3000). The `data/` folder is created automatically on first run.

To access from other devices on the same network use your machine's local IP — e.g. `http://192.168.1.x:3000`.

### Linux

Before running on Linux, install Chromium system dependencies:

```bash
sudo apt-get install -y libgbm1 libasound2 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libpango-1.0-0 libcairo2 libnss3 libnspr4
```

## API Endpoints

### Profiles & Favorites

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/profiles` | List all profiles |
| `POST` | `/api/profiles` | Create profile `{ name, theme }` |
| `GET` | `/api/profiles/:id` | Get profile by id |
| `PUT` | `/api/profiles/:id` | Update profile (name, theme) |
| `DELETE` | `/api/profiles/:id` | Delete profile + its favorites |
| `GET` | `/api/profiles/:id/favorites` | List favorites for a profile |
| `POST` | `/api/profiles/:id/favorites` | Add favorite `{ tmdbId, mediaType, title, posterPath }` |
| `DELETE` | `/api/profiles/:id/favorites/:tmdbId/:mediaType` | Remove a favorite |

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

### Playback (prehraj.to)

| Endpoint | Description |
|---|---|
| `GET /search?q=<query>` | Title search |
| `GET /get_video?url=<url>` | Extract video stream URL |
| `GET /autocomplete_data?q=<query>` | Autocomplete suggestions |

TMDB responses are cached in memory for 5 minutes.

## Browser Support

Any modern browser with ES6+ support (Chrome, Edge, Firefox, Safari).
