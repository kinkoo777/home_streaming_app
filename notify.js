// ================= NEW EPISODE NOTIFICATIONS (ntfy) =================
// A profile that set an ntfy topic (Nastavení → Upozornění) gets a phone notification
// when a series it follows — episodes in progress / watched, watched or favourite
// series — airs a new episode it hasn't seen. ntfy (ntfy.sh, or NTFY_SERVER) is a free
// push service: install the app, subscribe to the topic. Checked every hour; each
// episode is announced once per profile (data/notified.json).

const fs = require('fs');
const path = require('path');

const pad2 = n => String(n).padStart(2, '0');
const TOPIC = /^[A-Za-z0-9_-]{6,64}$/;

// deps: { dataDir, profiles, progress, watched, favorites, tmdbFetch, post(body), now() }
function createNotifier(deps) {
    const file = path.join(deps.dataDir, 'notified.json');
    const now = deps.now || (() => Date.now());
    function load() { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { return {}; } }
    function save(d) { fs.mkdirSync(deps.dataDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(d)); }

    // Series the profile follows → { tmdbId: title }
    function followed(profileId) {
        const out = {};
        const prog = deps.progress.getAll(profileId) || {};
        Object.keys(prog).forEach(k => {
            const m = /^(\d+):S\d+E\d+$/.exec(k);
            if (m) out[m[1]] = (prog[k] && prog[k].title || '').replace(/\s*S\d{2}E\d{2}.*$/i, '') || out[m[1]] || '';
        });
        deps.watched.list(profileId).filter(w => w.mediaType === 'tv').forEach(w => { out[w.tmdbId] = out[w.tmdbId] || w.title; });
        deps.favorites.list(profileId).filter(f => f.mediaType === 'tv').forEach(f => { out[f.tmdbId] = out[f.tmdbId] || f.title; });
        return out;
    }
    function seen(profileId, tmdbId, s, e) {
        const p = (deps.progress.getAll(profileId) || {})[`${tmdbId}:S${pad2(s)}E${pad2(e)}`];
        return !!(p && (p.finished || (p.duration && p.seconds / p.duration > 0.5)));
    }

    function publish(topic, title, message) {
        return deps.post({ topic, title, message, tags: ['tv'], click: process.env.FILMBOX_URL || undefined });
    }

    // One pass over every profile with a topic. → [{ profileId, show, code }] sent
    async function runOnce() {
        const sent = [];
        const store = load();
        const today = new Date(now()).toISOString().slice(0, 10);
        const twoDaysAgo = new Date(now() - 2 * 86400000).toISOString().slice(0, 10);
        for (const profile of deps.profiles.list()) {
            const topic = profile.settings && profile.settings.ntfyTopic;
            if (!topic || !TOPIC.test(topic)) continue;
            const mine = store[profile.id] || (store[profile.id] = {});
            const series = followed(profile.id);
            for (const id of Object.keys(series).slice(0, 40)) {
                let d;
                try { d = await deps.tmdbFetch(`/tv/${id}?language=cs-CZ`); } catch (e) { continue; }
                const last = d && d.last_episode_to_air;
                if (!last || !last.air_date || last.air_date < twoDaysAgo || last.air_date > today) continue;
                const code = `S${pad2(last.season_number)}E${pad2(last.episode_number)}`;
                const key = id + ':' + code;
                if (mine[key] || seen(profile.id, id, last.season_number, last.episode_number)) continue;
                const show = d.name || series[id] || 'Seriál';
                try {
                    await publish(topic, `Nový díl: ${show} ${code}`, (last.name ? last.name + '\n' : '') + 'Právě vyšel — pusťte si ho ve FilmBoxu.');
                    mine[key] = now();
                    sent.push({ profileId: profile.id, show, code });
                } catch (e) { console.error('ntfy:', e.message); }
            }
            // Forget announcements older than 60 days.
            Object.keys(mine).forEach(k => { if (now() - mine[k] > 60 * 86400000) delete mine[k]; });
        }
        save(store);
        return sent;
    }

    function start(intervalMs) {
        const tick = () => runOnce().catch(err => console.error('Upozornění:', err.message));
        setTimeout(tick, 2 * 60 * 1000).unref();
        setInterval(tick, intervalMs || 60 * 60 * 1000).unref();
    }

    return { runOnce, start, publish, followed };
}

// POST JSON to ntfy (https://docs.ntfy.sh/publish/#publish-as-json) — UTF-8 safe.
function ntfyPost(server) {
    return async body => {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 10000);
        try {
            const r = await fetch(server.replace(/\/+$/, '') + '/', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal
            });
            if (!r.ok) throw new Error('ntfy odpověděl ' + r.status);
        } finally { clearTimeout(t); }
    };
}

module.exports = { createNotifier, ntfyPost, TOPIC };
