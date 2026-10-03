// ── "Pustit na TV": phone → TV playback and a phone remote ──
//
// A TV page (home or player) keeps a Server-Sent Events connection open as a
// receiver: GET /api/cast/receiver?id=…&key=…&name=… . The key is a random
// secret the TV keeps in localStorage; whoever registers an id first owns it,
// so another device on the network can't listen in on that TV's commands
// (which can carry a profile's PIN session).
//
// Phones list receivers (GET /api/cast/devices), send commands
// (POST /api/cast/:id/command) and read the TV's playback state, which the TV
// player reports with POST /api/cast/:id/state. Everything lives in memory.

const ID = /^[a-z0-9]{8,40}$/;
const OFFLINE_AFTER = 20 * 1000;     // a TV moving from home to player reconnects within this
const STATE_KEYS = ['page', 'title', 'posterPath', 'tmdbId', 'mediaType', 'episodeLabel', 'position', 'duration', 'paused', 'subs', 'hasSubs', 'hasNext', 'muted'];

const devices = new Map();           // id → { id, key, name, res, lastSeen, state, stateAt }

function cleanName(v) {
    const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) : '';
    return s || 'Televize';
}

function isOnline(d) {
    return !!d.res || Date.now() - d.lastSeen < OFFLINE_AFTER;
}

function publicDevice(d) {
    return { id: d.id, name: d.name, online: !!d.res, state: d.state || null, stateAge: d.stateAt ? Date.now() - d.stateAt : null };
}

// Receiver connection (SSE). Returns false (and answers) if the id/key is refused.
function connect(req, res) {
    const id = String(req.query.id || '');
    const key = String(req.query.key || '');
    if (!ID.test(id) || !ID.test(key)) { res.status(400).json({ error: 'Neplatné id přijímače' }); return false; }
    let d = devices.get(id);
    if (d && d.key !== key) { res.status(403).json({ error: 'Toto id patří jinému přijímači' }); return false; }
    if (!d) { d = { id, key, name: '', res: null, lastSeen: Date.now(), state: null, stateAt: 0 }; devices.set(id, d); }
    d.name = cleanName(req.query.name);

    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    if (d.res && d.res !== res) d.res.end();          // a newer page of the same TV wins
    d.res = res;
    d.lastSeen = Date.now();
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
        clearInterval(ping);
        if (d.res === res) { d.res = null; d.lastSeen = Date.now(); }
    });
    return true;
}

function list() {
    const out = [];
    for (const d of devices.values()) if (isOnline(d)) out.push(publicDevice(d));
    return out;
}

function get(id) {
    const d = devices.get(id);
    return d && isOnline(d) ? publicDevice(d) : null;
}

// Push a command to a connected TV. False if it's not connected right now.
function send(id, command) {
    const d = devices.get(id);
    if (!d || !d.res) return false;
    d.res.write('data: ' + JSON.stringify(command) + '\n\n');
    return true;
}

// The TV reports what it's playing. Only the TV that owns the id may.
function setState(id, key, body) {
    const d = devices.get(id);
    if (!d || d.key !== key) return false;
    const st = {};
    for (const k of STATE_KEYS) {
        const v = body && body[k];
        if (typeof v === 'string') st[k] = v.slice(0, 300);
        else if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') st[k] = v;
    }
    d.state = st;
    d.stateAt = Date.now();
    return true;
}

module.exports = { connect, list, get, send, setState, ID };
