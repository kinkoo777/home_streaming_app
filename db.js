const fs   = require('fs');
const path = require('path');

const DATA_DIR       = path.join(__dirname, 'data');
const PROFILES_FILE  = path.join(DATA_DIR, 'profiles.json');
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function read(file) {
  ensure();
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function write(file, data) {
  ensure();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
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

  create({ name, picture = null, theme = 'dark' }) {
    const all = read(PROFILES_FILE);
    if (all.some(p => p.name === name)) {
      const err = new Error('Profile name already exists');
      err.code = 409;
      throw err;
    }
    const p = { id: newId(), name, picture, theme, createdAt: new Date().toISOString() };
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
    all[idx] = { ...all[idx], ...changes };
    write(PROFILES_FILE, all);
    return all[idx];
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

module.exports = { profiles, favorites };
