// net.js — graceful-degrading platform integration.
//
// Everything here tolerates failure: the game is fully playable offline.
// Server clock is fetched once at boot for the daily key; leaderboards and
// score submission fall back to local-only behavior. Funnel events are
// anonymous and sent via sendBeacon, silently dropped when offline.

const TIMEOUT_MS = 2000;

function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || TIMEOUT_MS);
  return fetch(url, { signal: ctrl.signal, method: opts.method || 'GET', body: opts.body, headers: opts.headers })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http-' + r.status))))
    .finally(() => clearTimeout(timer));
}

/**
 * Get the authoritative UTC date key ('YYYY-MM-DD'). Tries /api/v1/time and
 * applies the round-trip offset; on failure uses the local clock.
 * Returns {dateKey, nextDailyMs, source:'server'|'local', offsetMs}.
 */
export async function serverClock() {
  const local = () => {
    const now = new Date();
    return {
      dateKey: now.toISOString().slice(0, 10),
      nextDailyMs: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime(),
      source: 'local', offsetMs: 0,
    };
  };
  try {
    const t0 = Date.now();
    const res = await fetchJson('/api/v1/time');
    const t1 = Date.now();
    const serverMs = new Date(res.time).getTime();
    if (!Number.isFinite(serverMs)) return local();
    const offset = serverMs - (t0 + t1) / 2;
    const now = Date.now() + offset;
    const d = new Date(now);
    return {
      dateKey: d.toISOString().slice(0, 10),
      nextDailyMs: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now,
      source: 'server', offsetMs: offset,
    };
  } catch (e) {
    return local();
  }
}

/** Fetch a leaderboard board; resolves to null when unavailable. */
export async function fetchLeaderboard(board) {
  try {
    const res = await fetchJson('/api/v1/leaderboard?board=' + encodeURIComponent(board));
    return Array.isArray(res.entries) ? res.entries : null;
  } catch (e) {
    return null;
  }
}

/** Submit a ranked score envelope; resolves to true on acceptance. */
export async function submitScore(payload) {
  try {
    await fetchJson('/api/v1/scores', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      timeout: 4000,
    });
    return true;
  } catch (e) {
    return false;
  }
}

/** Anonymous funnel event; fire-and-forget, never throws. */
export function funnelEvent(type, data) {
  try {
    const body = JSON.stringify({ type, data: data || {}, at: Date.now() });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/v1/events', new Blob([body], { type: 'application/json' }));
    }
  } catch (e) { /* offline or blocked — drop silently */ }
}
