const fs     = require('fs');
const path   = require('path');
const bcrypt = require('bcryptjs');

// audioPref: 'dub' | 'original' | 'any' — which uploads the source picker ranks first
// qualityPref: '2160' | '1080' | '720'  — preferred upload resolution
// subLang: 'device' (last choice on that device) | 'off' | 'cze' | 'slo' | 'eng'
// stillWatching: ask "Sledujete ještě?" after 3 episodes played in a row
// previews: muted trailers in the hero and when hovering a card (never on TVs)
const DEFAULT_SETTINGS = {
  reduceMotion: false, autoplayTrailers: true,
  audioPref: 'dub', qualityPref: '1080', subLang: 'device', stillWatching: true, previews: true
};

// Strip pinHash before sending a profile to the client; expose only a boolean.
function sanitizeProfile(p) {
  if (!p) return p;
  const { pinHash, ...rest } = p;
  return { ...rest, settings: { ...DEFAULT_SETTINGS, ...(p.settings || {}) }, hasPin: !!pinHash };
}

// FILMBOX_DATA_DIR: somewhere else for the data (the API tests use a temp folder).
const DATA_DIR        = process.env.FILMBOX_DATA_DIR || path.join(__dirname, 'data');
const PROFILES_FILE   = path.join(DATA_DIR, 'profiles.json');
const FAVORITES_FILE  = path.join(DATA_DIR, 'favorites.json');
const WATCHED_FILE    = path.join(DATA_DIR, 'watched.json');
const WATCHLISTS_FILE = path.join(DATA_DIR, 'watchlists.json');
const PROGRESS_FILE   = path.join(DATA_DIR, 'progress.json');
const INTROS_FILE     = path.join(DATA_DIR, 'intros.json');
const HISTORY_FILE    = path.join(DATA_DIR, 'history.json');
const RATINGS_FILE    = path.join(DATA_DIR, 'ratings.json');
const HOUSEHOLD_FILE  = path.join(DATA_DIR, 'household.json');

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function read(file) {
  ensure();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    // A corrupt/half-written JSON file must not crash the whole app on every
    // request. Preserve the bad file for manual recovery, then degrade to empty.
    console.error(`Poškozený JSON soubor ${file}: ${err.message} — zálohuji a pokračuji s prázdnými daty.`);
    try { fs.renameSync(file, file + '.corrupt-' + Date.now()); } catch {}
    return [];
  }
}

function write(file, data) {
  ensure();
  // Atomic write: write to a temp file then rename, so a crash mid-write
  // can never leave a half-written / corrupt JSON file behind.
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Profiles ──

const profiles = {
  list() {
    return read(PROFILES_FILE);
  },

  get(id) {
    return read(PROFILES_FILE).find(p => p.id === id) || null;
  },

  create({ name, picture = null, theme = 'dark', kids = false }) {
    const all = read(PROFILES_FILE);
    if (all.some(p => p.name === name)) {
      const err = new Error('Profile name already exists');
      err.code = 409;
      throw err;
    }
    const p = {
      id: newId(), name, picture, theme,
      kids: !!kids,
      pinHash: null,
      settings: { ...DEFAULT_SETTINGS },
      createdAt: new Date().toISOString()
    };
    write(PROFILES_FILE, [...all, p]);
    return p;
  },

  update(id, changes) {
    const all = read(PROFILES_FILE);
    const idx = all.findIndex(p => p.id === id);
    if (idx === -1) return null;
    if (changes.name && all.some((p, i) => p.name === changes.name && i !== idx)) {
      const err = new Error('Profile name already exists');
      err.code = 409;
      throw err;
    }
    const { settings: settingsChange, pinHash: _ignorePinHash, ...rest } = changes;
    all[idx] = { ...all[idx], ...rest };
    if (settingsChange && typeof settingsChange === 'object') {
      all[idx].settings = { ...DEFAULT_SETTINGS, ...(all[idx].settings || {}), ...settingsChange };
    }
    write(PROFILES_FILE, all);
    return all[idx];
  },

  // Set (4-digit), or clear (null/empty) a profile PIN. Stored as a bcrypt hash.
  setPin(id, pin) {
    const all = read(PROFILES_FILE);
    const idx = all.findIndex(p => p.id === id);
    if (idx === -1) return null;
    if (pin == null || pin === '') {
      all[idx].pinHash = null;
    } else {
      if (!/^\d{4}$/.test(String(pin))) {
        const err = new Error('PIN must be exactly 4 digits');
        err.code = 400;
        throw err;
      }
      all[idx].pinHash = bcrypt.hashSync(String(pin), 10);
    }
    write(PROFILES_FILE, all);
    return all[idx];
  },

  // True if PIN matches, or if the profile has no PIN set.
  verifyPin(id, pin) {
    const p = read(PROFILES_FILE).find(x => x.id === id);
    if (!p) return false;
    if (!p.pinHash) return true;
    return bcrypt.compareSync(String(pin), p.pinHash);
  },

  delete(id) {
    const all = read(PROFILES_FILE);
    const next = all.filter(p => p.id !== id);
    if (next.length === all.length) return false;
    write(PROFILES_FILE, next);
    return true;
  }
};

// ── Favorites ──

const favorites = {
  list(profileId) {
    return read(FAVORITES_FILE)
      .filter(f => f.profileId === profileId)
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  },

  add({ profileId, tmdbId, mediaType, title, posterPath = null }) {
    tmdbId = Number(tmdbId);
    const all = read(FAVORITES_FILE);
    if (all.some(f => f.profileId === profileId && f.tmdbId === tmdbId && f.mediaType === mediaType)) {
      const err = new Error('Already in favorites');
      err.code = 409;
      throw err;
    }
    const f = { id: newId(), profileId, tmdbId, mediaType, title, posterPath, addedAt: new Date().toISOString() };
    write(FAVORITES_FILE, [f, ...all]);
    return f;
  },

  remove(profileId, tmdbId, mediaType) {
    const all = read(FAVORITES_FILE);
    const next = all.filter(f => !(f.profileId === profileId && f.tmdbId === Number(tmdbId) && f.mediaType === mediaType));
    if (next.length === all.length) return false;
    write(FAVORITES_FILE, next);
    return true;
  },

  deleteByProfile(profileId) {
    write(FAVORITES_FILE, read(FAVORITES_FILE).filter(f => f.profileId !== profileId));
  }
};

// ── Watched ──

const watched = {
  list(profileId) {
    return read(WATCHED_FILE)
      .filter(w => w.profileId === profileId)
      .sort((a, b) => b.watchedAt.localeCompare(a.watchedAt));
  },

  add({ profileId, tmdbId, mediaType, title, posterPath = null }) {
    const all = read(WATCHED_FILE);
    if (all.some(w => w.profileId === profileId && w.tmdbId === Number(tmdbId) && w.mediaType === mediaType)) {
      const err = new Error('Already watched');
      err.code = 409;
      throw err;
    }
    const w = { id: newId(), profileId, tmdbId: Number(tmdbId), mediaType, title, posterPath, watchedAt: new Date().toISOString() };
    write(WATCHED_FILE, [w, ...all]);
    return w;
  },

  remove(profileId, tmdbId, mediaType) {
    const all = read(WATCHED_FILE);
    const next = all.filter(w => !(w.profileId === profileId && w.tmdbId === Number(tmdbId) && w.mediaType === mediaType));
    if (next.length === all.length) return false;
    write(WATCHED_FILE, next);
    return true;
  },

  deleteByProfile(profileId) {
    write(WATCHED_FILE, read(WATCHED_FILE).filter(w => w.profileId !== profileId));
  }
};

// ── Watchlists ──

const watchlists = {
  getByProfile(profileId) {
    const all = read(WATCHLISTS_FILE);
    const entry = all.find(e => e.profileId === profileId);
    return entry ? entry.lists : [{ id: 'default', name: 'Můj seznam', movies: [] }];
  },

  saveByProfile(profileId, lists) {
    const all = read(WATCHLISTS_FILE);
    const idx = all.findIndex(e => e.profileId === profileId);
    if (idx >= 0) {
      all[idx].lists = lists;
    } else {
      all.push({ profileId, lists });
    }
    write(WATCHLISTS_FILE, all);
  },

  deleteByProfile(profileId) {
    write(WATCHLISTS_FILE, read(WATCHLISTS_FILE).filter(e => e.profileId !== profileId));
  }
};

// ── Progress ──

const progress = {
  getAll(profileId) {
    const all = read(PROGRESS_FILE);
    const entry = all.find(e => e.profileId === profileId);
    return entry ? entry.items : {};
  },

  // `key` is the tmdbId for movies/whole shows, or a composite "tmdbId:S01E05"
  // for individual TV episodes so each episode keeps its own position.
  // `data` carries the position plus enough display metadata (title, poster,
  // mediaType, episodeLabel) to render Continue Watching without localStorage.
  set(profileId, key, data) {
    const all = read(PROGRESS_FILE);
    const k   = String(key);
    const idx = all.findIndex(e => e.profileId === profileId);
    if (idx >= 0) {
      const prev    = all[idx].items[k];
      const prevObj = (prev && typeof prev === 'object') ? prev : {};
      all[idx].items[k] = { ...prevObj, ...data };
    } else {
      all.push({ profileId, items: { [k]: { ...data } } });
    }
    write(PROGRESS_FILE, all);
  },

  remove(profileId, key) {
    const all   = read(PROGRESS_FILE);
    const entry = all.find(e => e.profileId === profileId);
    if (!entry || !(String(key) in entry.items)) return false;
    delete entry.items[String(key)];
    write(PROGRESS_FILE, all);
    return true;
  },

  deleteByProfile(profileId) {
    write(PROGRESS_FILE, read(PROGRESS_FILE).filter(e => e.profileId !== profileId));
  }
};

// ── Watch history (for stats) ──
// Seconds actually played, per profile, day and title:
// [{ profileId, date: 'YYYY-MM-DD', items: { 'tv:1399': { seconds, tmdbId, mediaType, title, posterPath } } }]
// Episodes add up under their show.

function localDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

const history = {
  add(profileId, { seconds, tmdbId, mediaType, title, posterPath }, when = new Date()) {
    const all = read(HISTORY_FILE);
    const date = localDate(when);
    let day = all.find(d => d.profileId === profileId && d.date === date);
    if (!day) { day = { profileId, date, items: {} }; all.push(day); }
    const key = mediaType + ':' + tmdbId;
    const prev = day.items[key] || { seconds: 0 };
    day.items[key] = { seconds: prev.seconds + seconds, tmdbId, mediaType, title: title || prev.title || null, posterPath: posterPath || prev.posterPath || null };
    write(HISTORY_FILE, all);
  },

  list(profileId) {
    return read(HISTORY_FILE).filter(d => d.profileId === profileId);
  },

  deleteByProfile(profileId) {
    write(HISTORY_FILE, read(HISTORY_FILE).filter(d => d.profileId !== profileId));
  }
};

// ── Intros ──
// Where a show's opening titles start and end, marked once in the player and
// shared by every profile: [{ tmdbId, season, start, end, updatedAt }].

const intros = {
  // auto: found by introdetect.js (a mark set by hand replaces it);
  // credits: seconds before the end where the end credits start (also automatic).
  list(tmdbId) {
    return read(INTROS_FILE)
      .filter(i => i.tmdbId === tmdbId)
      .map(({ season, start, end, auto, credits }) => Object.assign({ season, start, end },
        auto ? { auto: true } : {}, credits ? { credits } : {}));
  },

  set(tmdbId, season, { start, end, auto, credits }) {
    const all = read(INTROS_FILE).filter(i => !(i.tmdbId === tmdbId && i.season === season));
    all.push(Object.assign({ tmdbId, season, start, end }, auto ? { auto: true } : {}, credits ? { credits } : {}, { updatedAt: new Date().toISOString() }));
    write(INTROS_FILE, all);
  },

  remove(tmdbId, season) {
    const all = read(INTROS_FILE);
    const next = all.filter(i => !(i.tmdbId === tmdbId && i.season === season));
    if (next.length === all.length) return false;
    write(INTROS_FILE, next);
    return true;
  }
};

// ── Ratings ── 👎 (-1) / 👍 (1) / 👍👍 (2) per profile and title:
// [{ profileId, tmdbId, mediaType, rating, title, posterPath, ratedAt }]

const ratings = {
  list(profileId) {
    return read(RATINGS_FILE)
      .filter(r => r.profileId === profileId)
      .sort((a, b) => b.ratedAt.localeCompare(a.ratedAt));
  },

  // rating 0 removes it. → the stored entry, or null when removed
  set(profileId, { tmdbId, mediaType, rating, title, posterPath = null }) {
    tmdbId = Number(tmdbId);
    const all = read(RATINGS_FILE).filter(r => !(r.profileId === profileId && r.tmdbId === tmdbId && r.mediaType === mediaType));
    if (!rating) { write(RATINGS_FILE, all); return null; }
    const r = { profileId, tmdbId, mediaType, rating, title, posterPath, ratedAt: new Date().toISOString() };
    write(RATINGS_FILE, [r, ...all]);
    return r;
  },

  deleteByProfile(profileId) {
    write(RATINGS_FILE, read(RATINGS_FILE).filter(r => r.profileId !== profileId));
  }
};

// ── Household ── things shared by the whole home: the parent PIN (kids profiles).
// { parentPinHash }
function readHousehold() {
  try { const h = JSON.parse(fs.readFileSync(HOUSEHOLD_FILE, 'utf8')); return h && typeof h === 'object' && !Array.isArray(h) ? h : {}; }
  catch (e) { return {}; }
}
const household = {
  hasParentPin() { return !!readHousehold().parentPinHash; },
  checkParentPin(pin) {
    const h = readHousehold();
    return !!h.parentPinHash && bcrypt.compareSync(String(pin || ''), h.parentPinHash);
  },
  // 4 digits, or null to remove it
  setParentPin(pin) {
    const h = readHousehold();
    if (pin == null || pin === '') delete h.parentPinHash;
    else {
      if (!/^\d{4}$/.test(String(pin))) { const err = new Error('PIN musí mít 4 číslice'); err.code = 400; throw err; }
      h.parentPinHash = bcrypt.hashSync(String(pin), 10);
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HOUSEHOLD_FILE, JSON.stringify(h, null, 2));
  }
};

module.exports = { profiles, favorites, watched, watchlists, progress, intros, history, ratings, household, localDate, sanitizeProfile, DATA_DIR };
