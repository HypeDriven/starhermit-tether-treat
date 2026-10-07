// platform.test.js — js/net.js over starhermit-sdk.js with a stubbed fetch
// and launch hash: token read, nickname, cloud-save path game:<slug>
// round-trip, settings patch, controls, and no network standalone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The SDK is a classic browser script; package.json "type": "module" makes
// Node treat .js as ESM, so evaluate it with a CommonJS shim.
const mod = { exports: {} };
new Function('module', 'exports', readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8'))(mod, mod.exports);
const SDK = mod.exports;
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `x.${b64url({ sub: 'u-12345678', game_scope: 'treat-test', exp: Math.floor(Date.now() / 1000) + 3600 })}.y`;

let n = 0;
async function setup(hash, hostname = 'treat-test.starhermit.com') {
  const calls = [], store = new Map();
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body, auth: init.headers?.Authorization });
    const path = url.split('?')[0];
    const json = (o) => new Response(JSON.stringify(o));
    if (path.endsWith('/profile')) return json({ nickname: 'Morsel Fan' });
    if (path.includes('/cloud-saves/')) {
      if (init.method === 'PUT') { store.set(path, JSON.parse(init.body).dataBase64); return new Response(null, { status: 204 }); }
      return store.has(path) ? new Response(Buffer.from(store.get(path), 'base64')) : new Response(null, { status: 404 });
    }
    if (path.endsWith('/settings')) return init.method === 'PATCH' ? new Response(null, { status: 204 }) : json({ settings: { muted: true } });
    if (path.endsWith('/controls')) return json({ actions: [{ action: 'hint', codes: ['KeyQ'] }] });
    return new Response(null, { status: 404 });
  };
  const location = { hash, search: '', pathname: '/', hostname };
  const win = { location, history: { state: null, replaceState: (_s, _t, u) => { location.hash = u.includes('#') ? u.slice(u.indexOf('#')) : ''; } } };
  globalThis.window = { location, addEventListener() {} };
  globalThis.document = { addEventListener() {}, hidden: false };
  globalThis.fetch = (...a) => fetch(...a);
  globalThis.StarHermit = SDK.create({ window: win, fetch });
  const net = await import('../js/net.js?case=' + (n++));
  return { calls, sh: globalThis.StarHermit, location, net };
}

test('launch token read + stripped; nickname from profile', async () => {
  const { net, sh, location } = await setup('#game_token=' + JWT);
  const r = net.initPlatform();
  assert.deepEqual(r, { hosted: true, sub: 'u-12345678', gameScope: 'treat-test' });
  assert.equal(location.hash, '');
  assert.equal(await net.loadNickname(), 'Morsel Fan');
  sh.signOut();
});

test('cloud save round-trips through game:<slug>', async () => {
  const { net, sh, calls } = await setup('#game_token=' + JWT);
  net.initPlatform();
  assert.equal(await net.loadCloudSave(), null);
  net.scheduleCloudSave({ levels: { 'w1-1': { stars: 3 } } });
  await net.flushCloudSave();
  const put = calls.find((c) => c.method === 'PUT');
  assert.ok(put.url.endsWith('/api/v1/me/cloud-saves/' + encodeURIComponent('game:treat-test')));
  assert.equal(put.auth, 'Bearer ' + JWT);
  assert.equal((await net.loadCloudSave()).progress.levels['w1-1'].stars, 3);
  sh.signOut();
});

test('settings KV + controls + invite link', async () => {
  const { net, sh, calls } = await setup('#game_token=' + JWT);
  net.initPlatform();
  assert.deepEqual(await net.loadPlatformSettings({ muted: false, music: 0.6 }), { muted: true });
  net.pushSettings({ muted: true, music: 0.2 });
  await new Promise((r) => setTimeout(r, 900));
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch.url.endsWith('/api/v1/games/treat-test/settings'));
  assert.deepEqual(JSON.parse(patch.body), { settings: { music: 0.2 } });
  const b = await net.loadBindings();
  assert.deepEqual(b.hint, ['KeyQ']);
  assert.deepEqual(b.undo, ['KeyU']);
  assert.match(net.inviteLink(), /game-invite\/u-12345678\/treat-test$/);
  sh.signOut();
});

test('standalone: no network calls', async () => {
  const { net, calls } = await setup('', 'example.com');
  assert.equal(net.initPlatform().hosted, false);
  assert.equal(net.canSignIn(), false);
  assert.equal(net.inviteLink(), null);
  assert.equal(net.serverClock().source, 'local');
  assert.equal(await net.loadNickname(), null);
  assert.equal(await net.loadCloudSave(), null);
  net.scheduleCloudSave({});
  net.pushSettings({ music: 0 });
  assert.equal(await net.fetchLeaderboard('global'), null);
  assert.deepEqual(await net.submitScore(900), { posted: false, rank: null });
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(calls.length, 0);
});

test('sign-in offered on the platform host without a token', async () => {
  const { net, calls } = await setup('');
  net.initPlatform();
  assert.equal(net.canSignIn(), true);
  assert.equal(calls.length, 0);
});
