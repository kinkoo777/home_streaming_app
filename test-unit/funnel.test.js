// Public room links: PUBLIC_URL clean-up and Tailscale Funnel detection (funnel.js).
const test = require('node:test');
const assert = require('node:assert');
const { normalizeUrl, funnelUrlFrom } = require('../funnel');
const { startServer } = require('./server-harness');

test('normalizeUrl accepts a bare host name', () => {
    assert.strictEqual(normalizeUrl('user-1.taild531ef.ts.net'), 'https://user-1.taild531ef.ts.net');
    assert.strictEqual(normalizeUrl('  https://user-1.taild531ef.ts.net/  '), 'https://user-1.taild531ef.ts.net');
    assert.strictEqual(normalizeUrl('http://kino.example.cz:8080/filmbox/'), 'http://kino.example.cz:8080/filmbox');
    assert.strictEqual(normalizeUrl(''), '');
    assert.strictEqual(normalizeUrl(undefined), '');
    assert.strictEqual(normalizeUrl('https://exa mple'), '');
});

test('funnelUrlFrom finds the Funnel that forwards to the guest port', () => {
    const cfg = {
        TCP: { 443: { HTTPS: true } },
        Web: { 'user-1.taild531ef.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3001' } } } },
        AllowFunnel: { 'user-1.taild531ef.ts.net:443': true }
    };
    assert.strictEqual(funnelUrlFrom(cfg, 3001), 'https://user-1.taild531ef.ts.net');
    assert.strictEqual(funnelUrlFrom(cfg, 3000), null, 'a Funnel to another port is not ours');
    // Funnel on another HTTPS port, proxy written as localhost / bare port
    assert.strictEqual(funnelUrlFrom({ Web: { 'pi.t.ts.net:8443': { Handlers: { '/': { Proxy: 'localhost:3001' } } } }, AllowFunnel: { 'pi.t.ts.net:8443': true } }, 3001), 'https://pi.t.ts.net:8443');
    assert.strictEqual(funnelUrlFrom({ Web: { 'pi.t.ts.net:443': { Handlers: { '/': { Proxy: '3001' } } } }, AllowFunnel: { 'pi.t.ts.net:443': true } }, 3001), 'https://pi.t.ts.net');
    // Served only inside the tailnet (serve, not funnel) → not public
    assert.strictEqual(funnelUrlFrom({ Web: cfg.Web, AllowFunnel: {} }, 3001), null);
    assert.strictEqual(funnelUrlFrom({ Web: cfg.Web, AllowFunnel: { 'user-1.taild531ef.ts.net:443': false } }, 3001), null);
    assert.strictEqual(funnelUrlFrom({ Web: { 'pi:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:30011' } } } }, AllowFunnel: { 'pi:443': true } }, 3001), null);
    assert.strictEqual(funnelUrlFrom(null, 3001), null);
    assert.strictEqual(funnelUrlFrom({}, 3001), null);
});

test('room links use PUBLIC_URL even when it is written without https://', async () => {
    const srv = await startServer({ PUBLIC_URL: 'user-1.taild531ef.ts.net' });
    try {
        const res = await fetch(srv.base + '/api/rooms', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player: { title: 'X', source: { qualities: [{ src: 'https://cdn1.premiumcdn.net/a.mp4' }] } } })
        });
        const room = await res.json();
        assert.strictEqual(room.link, 'https://user-1.taild531ef.ts.net/r/' + room.id);
        assert.strictEqual(room.public, true);
        const info = await (await fetch(`${srv.guestBase}/api/rooms/${room.id}`)).json();
        assert.strictEqual(info.link, room.link);
    } finally { srv.stop(); }
});
