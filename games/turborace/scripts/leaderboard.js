import { supabase } from './supabase.js';
import { sanitizeUserId, sanitizeLeaderboardName, loadArcadeUser } from './user.js';
import { state } from './state.js';
import { fmtT } from './util.js';

export const LEADERBOARD_TABLE = 'turborace_leaderboard';
export const leaderboardByTrack = new Map();
export let leaderboardAvailable = true;
let currentRaceSubmitted = false;

function sanitizeGhostFrame(frame) {
  if (!frame || typeof frame !== 'object') return null;
  const t = Math.round(Number(frame.t));
  const x = Number(frame.x);
  const y = Number(frame.y);
  const z = Number(frame.z);
  const h = Number(frame.h);
  if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(h)) return null;
  return { t, x, y, z, h };
}

function sanitizeGhostData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const carData = raw.carData && typeof raw.carData === 'object' ? { ...raw.carData } : null;
  const username = sanitizeLeaderboardName(raw.username);
  const frames = Array.isArray(raw.frames) ? raw.frames.map(sanitizeGhostFrame).filter(Boolean) : [];
  if (!carData || frames.length < 2) return null;
  return {
    username,
    carData,
    frames,
    timeMs: Math.max(0, Number(raw.timeMs) || 0)
  };
}

export function isCurrentRaceSubmitted(){
  return currentRaceSubmitted;
}

export function resetCurrentRaceSubmitted(){
  currentRaceSubmitted=false;
}

export function markCurrentRaceSubmitted(){
  currentRaceSubmitted=true;
}

export function normaliseTrackId(trackId, trackName = '') {
  const rawId = trackId === null || trackId === undefined || trackId === '' ? 'unknown' : String(trackId);
  const rawName = trackName;
  const slug = String(rawName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (!slug) return rawId;
  return `${rawId}:${slug}`;
}

function getTrackIdCandidates(trackId, trackName = '') {
  const preferred = normaliseTrackId(trackId, trackName);
  const legacy = normaliseTrackId(trackId);
  if (preferred === legacy) return [preferred];
  return [preferred, legacy];
}

export function leaderboardTimeToSeconds(timeMs) {
  const numeric = Math.max(0, Number(timeMs) || 0);
  if (numeric < 1000) return numeric;
  return numeric / 1000;
}

function leaderboardComparableTimeMs(timeMs) {
  const numeric = Math.max(0, Number(timeMs) || 0);
  if (numeric < 1000) return Math.round(numeric * 1000);
  return Math.round(numeric);
}

export function renderLeaderboardRows(container, entries, highlightName) {
  if (!container) return;
  if (!entries || !entries.length) {
    container.innerHTML = '<div class="lb-empty">No leaderboard entries yet for this track.</div>';
    return;
  }
  container.innerHTML = '';
  entries.forEach((entry, idx) => {
    const row = document.createElement('div');
    row.className = 'lb-row' + (highlightName && entry.username === highlightName ? ' lb-row-you' : '');
    const ghostMarker = entry.ghost_data ? '<span class="lb-ghost-marker" title="Ghost data available" aria-label="Ghost data available">👻</span>' : '';
    const carLabel = entry.car_name ? `<div class="lb-car"><span class="lb-car-dot" style="background:${entry.car_hex || '#fff'}"></span>${entry.car_name}</div>` : '';
    row.innerHTML = `<span class="lb-pos">${idx + 1}</span><span class="lb-name">${entry.username}${ghostMarker}${carLabel}</span><span class="lb-time">${fmtT(leaderboardTimeToSeconds(entry.time_ms))}</span>`;
    container.appendChild(row);
  });
}

export function renderResultsLeaderboard(entries, highlightName) {
  const board = document.getElementById('resultsLeaderboard');
  renderLeaderboardRows(board, entries, highlightName);
}

export function updateTrackCardBestTime(trackId, trackName = '') {
  const key = normaliseTrackId(trackId, trackName);
  const data = leaderboardByTrack.get(key);
  const el = document.querySelector(`[data-track-best="${CSS.escape(key)}"]`);
  if (!el) return;
  if (!leaderboardAvailable) el.textContent = 'Best: leaderboard unavailable';
  else if (!data || !data.best) el.textContent = 'Best: --';
  else el.textContent = `Best: ${fmtT(leaderboardTimeToSeconds(data.best.time_ms))} · ${data.best.username}`;
}

export async function loadTrackLeaderboard(trackId, { force = false, limit = 10, trackName = '' } = {}) {
  const [key, ...legacyKeys] = getTrackIdCandidates(trackId, trackName);
  if (!leaderboardAvailable) return { best: null, entries: [] };
  if (!force && leaderboardByTrack.has(key)) return leaderboardByTrack.get(key);
  const { data, error } = await supabase.from(LEADERBOARD_TABLE)
    .select('*')
    .in('track_id', [key, ...legacyKeys])
    .order('time_ms', { ascending: true })
    .limit(limit);
  if (error) {
    console.error('Leaderboard fetch error:', error);
    leaderboardAvailable = false;
    return { best: null, entries: [] };
  }
  const entries = (data || []).map((row) => ({
    track_id: String(row.track_id || ''),
    user_id: sanitizeUserId(row.user_id),
    username: sanitizeLeaderboardName(row.username),
    car_name: String(row.car_name || '').trim().slice(0, 30),
    car_hex: /^#[0-9a-f]{6}$/i.test(String(row.car_hex || '')) ? String(row.car_hex) : null,
    time_ms: Math.max(0, Number(row.time_ms) || 0),
    ghost_data: sanitizeGhostData(row.ghost_data)
  })).sort((a, b) => leaderboardComparableTimeMs(a.time_ms) - leaderboardComparableTimeMs(b.time_ms));
  const payload = { best: entries[0] || null, entries };
  leaderboardByTrack.set(key, payload);
  return payload;
}

export async function submitTrackTime(trackId, user, timeMs, car, ghostData = null, trackName = '') {
  const [key, ...legacyKeys] = getTrackIdCandidates(trackId, trackName);
  if (!leaderboardAvailable) return false;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session || !session.user) {
    console.info('Leaderboard submit skipped: sign in required.');
    return false;
  }

  const sessionUserId = sanitizeUserId(session.user.id);
  const userId = sessionUserId || sanitizeUserId(user.user_id);
  const username = sanitizeLeaderboardName(
    user.name || session.user.user_metadata?.username || session.user.email?.split('@')[0] || 'Player'
  );
  const nextTimeMs = Math.round(Math.max(0, timeMs || 0) * 1000);
  const payload = {
    track_id: key,
    user_id: userId,
    username,
    car_name: String(car?.name || '').trim().slice(0, 30) || null,
    car_hex: /^#[0-9a-f]{6}$/i.test(String(car?.hex || '')) ? String(car.hex).toLowerCase() : null,
    time_ms: nextTimeMs,
    ghost_data: sanitizeGhostData(ghostData)
  };

  const { data: existingRows, error: existingError } = await supabase.from(LEADERBOARD_TABLE)
    .select('id,time_ms,track_id')
    .in('track_id', [key, ...legacyKeys])
    .eq('user_id', userId);
  if (existingError) {
    console.error('Leaderboard existing row lookup error:', existingError);
    return false;
  }

  const rows = Array.isArray(existingRows) ? existingRows : [];
  const fastestExisting = rows.length
    ? rows.reduce((best, row) => (leaderboardComparableTimeMs(row.time_ms) < leaderboardComparableTimeMs(best.time_ms) ? row : best), rows[0])
    : null;
  const shouldReplaceExisting = !fastestExisting || nextTimeMs < leaderboardComparableTimeMs(fastestExisting.time_ms);

  let error = null;
  if (!fastestExisting) {
    ({ error } = await supabase.from(LEADERBOARD_TABLE).insert(payload));
  } else if (shouldReplaceExisting) {
    ({ error } = await supabase.from(LEADERBOARD_TABLE)
      .update(payload)
      .eq('id', fastestExisting.id));
  }

  const staleRowsToDelete = rows.filter((row) => !fastestExisting || row.id !== fastestExisting.id);
  if (!error && staleRowsToDelete.length) {
    const { error: deleteError } = await supabase.from(LEADERBOARD_TABLE)
      .delete()
      .in('id', staleRowsToDelete.map((row) => row.id));
    if (deleteError) {
      console.error('Leaderboard cleanup delete error:', deleteError);
      return false;
    }
  }

  if (!error) {
    const { data: postWriteRows, error: postWriteError } = await supabase.from(LEADERBOARD_TABLE)
      .select('id,time_ms')
      .in('track_id', [key, ...legacyKeys])
      .eq('user_id', userId)
      .order('time_ms', { ascending: true });
    if (postWriteError) {
      console.error('Leaderboard post-write verify error:', postWriteError);
      return false;
    }
    const postRows = Array.isArray(postWriteRows) ? postWriteRows : [];
    if (postRows.length > 1) {
      const idsToDelete = postRows.slice(1).map((row) => row.id);
      if (idsToDelete.length) {
        const { error: cleanupError } = await supabase.from(LEADERBOARD_TABLE)
          .delete()
          .in('id', idsToDelete);
        if (cleanupError) {
          console.error('Leaderboard post-write cleanup delete error:', cleanupError);
          return false;
        }
      }
    }
  }

  if (error) {
    console.error('Leaderboard submit error:', error);
    const msg = String(error.message || '').toLowerCase();
    const authBlocked = msg.includes('row-level security') || msg.includes('permission denied');
    if (!authBlocked) leaderboardAvailable = false;
    return false;
  }
  return true;
}

export async function handlePostRaceLeaderboard(notify, ghostData = null) {
  if (currentRaceSubmitted || !state.trkData || !state.pCar || !state.pCar.finTime || !Number.isFinite(state.pCar.finTime)) return;
  currentRaceSubmitted = true;
  const user = await loadArcadeUser();
  const ok = await submitTrackTime(state.trkData.id, user, state.pCar.finTime, state.pCar.data, ghostData, state.trkData.name);
  const latest = await loadTrackLeaderboard(state.trkData.id, { force: true, limit: 10, trackName: state.trkData.name });
  renderResultsLeaderboard(latest.entries, user.name);
  updateTrackCardBestTime(state.trkData.id, state.trkData.name);

  if (ok) {
    notify('Leaderboard time saved!');
  } else {
    notify('Leaderboard submit skipped (sign in required).');
  }
}

export async function openTrackLeaderboardModal(trackId, trackName) {
  const modal = document.getElementById('leaderboardModal');
  const title = document.getElementById('leaderboardModalTitle');
  const list = document.getElementById('leaderboardModalList');
  if (!modal || !title || !list) return;
  title.textContent = `${trackName} Leaderboard`;
  list.innerHTML = '<div class="lb-empty">Loading leaderboard…</div>';
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  const data = await loadTrackLeaderboard(trackId, { force: true, limit: 50, trackName });
  renderLeaderboardRows(list, data.entries);
}

export function closeTrackLeaderboardModal() {
  const modal = document.getElementById('leaderboardModal');
  if (!modal) return;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
}
