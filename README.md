# FilmBox

A Netflix-style home streaming platform UI built with vanilla HTML, CSS and JavaScript. Pulls movie and TV show data from the TMDB API and links playback through prehraj.to.

## Features

- **Intro animation** — Netflix-style logo entrance with a Web Audio "ta-dum" sound
- **Multi-profile support** — choose or create profiles (stored in localStorage), each with a custom name and color
- **Hero banner** — rotating weekly trending movies with backdrop image, title and description
- **3 browsable grids** — Most Visited, Trending, and Top Rated; each with genre filters, sort tabs (default / rating / year) and a load-more button
- **Search** — live TMDB search with a result dropdown and search history
- **Detail modal** — poster, genres, cast, overview, trailer button, watchlist button, season/episode list for TV shows, and a similar titles grid
- **Trailer modal** — embedded YouTube player
- **Actor modal** — photo, biography and top works
- **Watchlist** — multi-list system (create, rename, delete lists); "Continue watching" section with progress bars
- **Player** — searches prehraj.to for the selected title; supports custom search name if nothing is found automatically
- **Dark mode toggle** — persisted in localStorage
- **Fully responsive** — phone (360 px) → tablet → laptop → large TV (1800 px+)
- **Mobile search overlay** — full-screen search panel on small screens

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML / CSS / JavaScript (no frameworks) |
| Icons | Bootstrap Icons (CDN) |
| Movie data | TMDB API v3 |
| Playback source | prehraj.to (scraping) |
| Backend | Node.js + Express |
| Scraping | JSDOM (search results) + Puppeteer (video extraction) |
| Tests | Playwright |

## Project Structure

```
films-hun/
├── server.js           # Express server (TMDB proxy + prehraj.to scraping)
├── package.json
├── tests/
│   └── app.test.js     # Playwright end-to-end tests
└── src/
    ├── index.html
    ├── css/
    │   ├── base.css
    │   ├── navbar.css
    │   ├── hero.css
    │   ├── cards.css
    │   ├── grid.css
    │   ├── modals.css
    │   ├── watchlist.css
    │   ├── responsive.css
    │   └── intro.css
    └── js/
        ├── intro.js      # Intro animation + profile chooser
        ├── utils.js      # Shared helpers (toast, skeletons, genre map)
        ├── watchlist.js  # Multi-list watchlist + continue watching
        ├── cards.js      # Movie cards, grid state, filters, fetch
        ├── trailer.js    # Trailer modal
        ├── actor.js      # Actor modal
        ├── player.js     # prehraj.to search + video modal
        ├── detail.js     # Detail modal + season browser
        ├── search.js     # Live search + theme toggle
        ├── hero.js       # Hero banner rotation
        └── main.js       # Init + navbar scroll links
```

## Getting Started

### Prerequisites

- Node.js 18+
- A free TMDB API key from [themoviedb.org](https://www.themoviedb.org/settings/api)

### Install

```bash
npm install
```

### Configure

Open `server.js` and replace the `TMDB_API_KEY` and `TMDB_AUTH` values at the top of the file with your own credentials from TMDB.

### Run

```bash
node server.js
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

To access from other devices on the same network, use your machine's local IP address instead of `localhost` — e.g. `http://192.168.1.x:3000`. The server listens on `0.0.0.0` so all relative API calls from the frontend will resolve correctly.

### Run Tests

```bash
npx playwright test
```

## Server API Endpoints

| Endpoint | Description |
|---|---|
| `GET /tmdb/movies?type=popular\|trending\|top_rated&page=N` | Paginated movie/TV lists |
| `GET /tmdb/search?q=<query>` | TMDB multi-search |
| `GET /tmdb/details?id=&type=movie\|tv` | Movie/TV details + cast |
| `GET /tmdb/videos?id=&type=` | Trailers |
| `GET /tmdb/similar?id=&type=` | Similar titles |
| `GET /tmdb/actor?id=` | Actor bio + works |
| `GET /tmdb/season?id=&season=N` | TV season episodes |
| `GET /tmdb/hero` | Trending movies for hero banner |
| `GET /search?q=<query>` | prehraj.to title search (JSDOM) |
| `GET /get_video?url=<url>` | Extract video stream URL (Puppeteer) |
| `GET /autocomplete_data?q=<query>` | prehraj.to autocomplete suggestions |

All TMDB responses are cached in memory for 5 minutes.

## Browser Support

Chrome / Edge / Firefox / Safari — any modern browser with ES6+ support.
