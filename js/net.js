// net.js — graceful-degrading platform integration.
//
// Platform reality: in production the host serves exactly ONE API route,
// GET /api/v1/time. Every other /api/v1/* route (events, leaderboard,
// scores, daily, ...) returns 404 once deployed — this game's own server.js
// is not run by the platform. So nothing may be requested unless it is
// known to exist: the time endpoint is probed ONCE at startup to set the
// 'hosted' flag, and every other hosted feature is a local no-op that never
// issues a request. The game remains fully playable offline.

const TIMEOUT_MS = 2000;

let hosted = false;

function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || TIMEOUT_MS);
  return fetch(url, { signal: ctrl.signal, method: opts.method || 'GET', body: opts.body, headers: opts.headers })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http-' + r.status))))
    .finally(() => clearTimeout(timer));
}

/**
 * Get the authoritative UTC date key ('YYYY-MM-DD'). Probes /api/v1/time
 * once and applies the round-trip offset; on failure uses the local clock.
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
    hosted = true;
    const offset = serverMs - (t0 + t1) / 2;
    const now = Date.now() + offset;
    const d = new Date(now);
    return {
      dateKey: d.toISOString().slice(0, 10),
      nextDailyMs: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now,
      source: 'server', offsetMs: offset,
    };
  } catch (e) {
    hosted = false;
    return local();
  }
}

/** Leaderboards have no production route; resolve to the local fallback. */
export async function fetchLeaderboard(board) {
  void hosted; void board;
  return null;
}

/** Score submission has no production route; the score is kept locally. */
export async function submitScore(payload) {
  void hosted; void payload;
  return false;
}

/** Anonymous funnel event; there is no hosted events route — drop locally. */
export function funnelEvent(type, data) {
  void hosted; void type; void data;
}
