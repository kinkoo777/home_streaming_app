# Per-Profile Settings Menu — Design Spec

**Date:** 2026-06-03
**Status:** Approved, in implementation

## Goal

Add a per-profile **Settings menu** (gear icon in the header) where a user can change their
**name**, **profile picture**, **theme**, set/remove a **4-digit PIN**, and toggle a few
preferences. Everything is persisted in the JSON store; every profile has its own settings.
The existing header theme toggle stays and remains in sync.

## Data model — `data/profiles.json`

Each profile object, extended:

```jsonc
{
  "id": "...",
  "name": "Vlad",
  "picture": "data:image/jpeg;base64,...",   // or null
  "theme": "dark",                            // "dark" | "light"
  "createdAt": "2026-...",
  "pinHash": "$2a$10$...",                     // bcrypt hash, or null when no PIN
  "settings": {
    "reduceMotion": false,
    "autoplayTrailers": true
  }
}
```

- `pinHash` is **NEVER** sent to the browser.
- Profiles missing `settings` default to `{ reduceMotion: false, autoplayTrailers: true }`.
- Profiles missing `pinHash` are treated as no-PIN.

## API contract (authoritative — all agents build to this)

All profile responses are **sanitized**: `pinHash` is removed and a boolean `hasPin` is added.

| Method | Endpoint | Body | Response |
|---|---|---|---|
| `GET` | `/api/profiles` | — | `[{...profile, hasPin}]` (no `pinHash`) |
| `GET` | `/api/profiles/:id` | — | `{...profile, hasPin}` |
| `PUT` | `/api/profiles/:id` | any of `{ name, picture, theme, settings }` | sanitized profile |
| `POST` | `/api/profiles/:id/pin` | `{ pin }` — 4 digits to set, `null`/empty to clear | `{ hasPin: bool }` |
| `POST` | `/api/profiles/:id/pin/verify` | `{ pin }` | `{ ok: true \| false }` |
| `DELETE` | `/api/profiles/:id` | — | `{ message }` (existing; cascades) |

- `settings` in PUT is **shallow-merged** into the existing settings (partial updates allowed).
- `POST /pin` with a non-4-digit, non-null `pin` → `400`.
- bcrypt is already a dependency (`bcryptjs`).

## Frontend contract (shared symbols across agents)

- **DOM IDs** (owned by `settings-ui`, referenced by `auth-flow`):
  - Header gear button: `id="settings-btn"` (inside `header .actions`, before `#theme-toggle`).
  - Settings modal root: `id="settings-modal"`.
  - PIN-prompt modal root: `id="pin-prompt-modal"`.
- **Global functions:**
  - `window.openSettings()` — opens settings modal for the active profile. (`settings-ui`)
  - `window.openPinPrompt(profile)` → `Promise<boolean>` — shows the PIN modal, resolves
    `true` when the entered PIN verifies server-side, `false` if cancelled. (`settings-ui`)
  - `window.applyProfileSettings(profile)` — applies `reduceMotion`/`theme` to `document.body`
    (adds/removes `body.reduce-motion`, `body.dark`). (`auth-flow` defines; `settings-ui` may call)
- **CSS class:** `body.reduce-motion` disables animations/transitions (rule in `animations.css`).
- **Active profile** lives in `sessionStorage['filmbox_active_profile']` as JSON (existing).
  When settings change, agents must update this cached copy too.

## File ownership (NO overlap — enables parallel agents)

| Agent | Files (exclusive) |
|---|---|
| **backend** | `db.js`, `server.js` |
| **settings-ui** | NEW `src/js/settings.js`, NEW `src/css/settings.css`, `src/index.html` |
| **auth-flow** | `src/js/intro.js`, `src/js/detail.js`, `src/css/animations.css` |

## Component details

### backend (`db.js`, `server.js`)
- `db.js`: add `sanitize(profile)` (strip `pinHash`, add `hasPin`); apply in `list()`/`get()`
  return paths **or** at the route layer — choose route layer so internal verify still has the
  hash. Add `profiles.setPin(id, pin|null)` (bcrypt hash or clear) and
  `profiles.verifyPin(id, pin)` → bool. Extend `update()` to merge `settings`.
- `server.js`: sanitize all profile responses; add the two `/pin` routes; extend `PUT`.
- Default `settings` + null `pinHash` on `create()`.

### settings-ui (`settings.js`, `settings.css`, `index.html`)
- Add gear `#settings-btn` to header `.actions` (Bootstrap icon `bi-gear`), before theme toggle.
- Build `#settings-modal` with sections: **Name** (text input + save), **Picture**
  (file input → resize to 256×256 via `<canvas>` → data URL → live preview, + "remove"),
  **Theme** (dark/light buttons, reuse `.theme-option` style; keep header toggle in sync),
  **PIN** (set/change 4 digits, remove), **Preferences** (reduce motion, autoplay trailers
  toggles), **Delete profile** (confirm → `DELETE` → reload to chooser).
- Build `#pin-prompt-modal` markup + `window.openPinPrompt(profile)` logic (4 inputs / single
  field, verify via `POST /pin/verify`, shake on wrong).
- All saves PUT to the API and update `sessionStorage['filmbox_active_profile']`, navbar badge
  (`updateNavbarProfile` is in intro.js — call via a global if exposed, else re-render minimally).
- Czech UI strings to match the rest of the app.

### auth-flow (`intro.js`, `detail.js`, `animations.css`)
- `intro.js`: in `chooseProfile`/grid click, if `profile.hasPin` → `await window.openPinPrompt(profile)`;
  only proceed on `true`. On boot with a cached active profile, do NOT re-prompt. Expose
  `window.updateNavbarProfile` and `window.applyProfileSettings`. Apply `reduceMotion` on boot
  and on switch.
- `detail.js`: gate trailer autoplay on active profile's `settings.autoplayTrailers`.
- `animations.css`: add `body.reduce-motion *, body.reduce-motion *::before/after { animation:none!important; transition:none!important; }`.

## Out of scope (YAGNI)
- No account system / multi-device sync. No password recovery (PIN reset = remove via an
  already-unlocked session or delete profile). No rate-limiting on PIN attempts.

## Testing
- Manual: set PIN → switch away → switch back prompts → wrong PIN blocks, right PIN enters.
- Change name/picture/theme/prefs → persists across reload (check `data/profiles.json`).
- `reduce-motion` disables animations; `autoplayTrailers=false` stops trailer autoplay.
- `GET /api/profiles` never contains `pinHash`.
