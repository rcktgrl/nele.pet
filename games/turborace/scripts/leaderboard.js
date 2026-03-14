import { supabase } from './supabase.js';
import { sanitizeUserId, sanitizeLeaderboardName, loadArcadeUser } from './user.js';
import { state } from './state.js';
import { fmtT } from './util.js';

export const LEADERBOARD_TABLE = 'turborace_leaderboard';
export const leaderboardByTrack = new Map();
export let leaderboardAvailable = true;
let currentRaceSubmitted = false;

export function isCurrentRaceSubmitted(){
  return currentRaceSubmitted;
}

export function resetCurrentRaceSubmitted(){
  currentRaceSubmitted=false;
}

export function markCurrentRaceSubmitted(){
  currentRaceSubmitted=true;
}

export function normaliseTrackId(trackId) {
  if (trackId === null || trackId === undefined || trackId === '') return 'unknown';
  return String(trackId);
}

export function leaderboardTimeToSeconds(timeMs) {
  const numeric = Math.max(0, Number(timeMs) || 0);
  if (numeric < 1000) return numeric;
  return numeric / 1000;
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
    const carLabel = entry.car_name ? `<div class="lb-car"><span class="lb-car-dot" style="background:${entry.car_hex || '#fff'}"></span>${entry.car_name}</div>` : '';
    row.innerHTML = `<span class="lb-pos">${idx + 1}</span><span class="lb-name">${entry.username}${carLabel}</span><span class="lb-time">${fmtT(leaderboardTimeToSeconds(entry.time_ms))}</span>`;
    container.appendChild(row);
  });
}

export function renderResultsLeaderboard(entries, highlightName) {
  const board = document.getElementById('resultsLeaderboard');
  renderLeaderboardRows(board, entries, highlightName);
}

export function updateTrackCardBestTime(trackId) {
  const data = leaderboardByTrack.get(normaliseTrackId(trackId));
  const el = document.querySelector(`[data-track-best="${CSS.escape(normaliseTrackId(trackId))}"]`);
  if (!el) return;
  if (!leaderboardAvailable) el.textContent = 'Best: leaderboard unavailable';
  else if (!data || !data.best) el.textContent = 'Best: --';
  else el.textContent = `Best: ${fmtT(leaderboardTimeToSeconds(data.best.time_ms))} · ${data.best.username}`;
}

export async function loadTrackLeaderboard(trackId, { force = false, limit = 10 } = {}) {
  const key = normaliseTrackId(trackId);
  if (!leaderboardAvailable) return { best: null, entries: [] };
  if (!force && leaderboardByTrack.has(key)) return leaderboardByTrack.get(key);
  const { data, error } = await supabase.from(LEADERBOARD_TABLE)
    .select('*')
    .eq('track_id', key)
    .order('time_ms', { ascending: true })
    .limit(limit);
  if (error) {
    console.error('Leaderboard fetch error:', error);
    leaderboardAvailable = false;
    return { best: null, entries: [] };
  }
  const entries = (data || []).map((row) => ({
    track_id: normaliseTrackId(row.track_id),
    user_id: sanitizeUserId(row.user_id),
    username: sanitizeLeaderboardName(row.username),
    car_name: String(row.car_name || '').trim().slice(0, 30),
    car_hex: /^#[0-9a-f]{6}$/i.test(String(row.car_hex || '')) ? String(row.car_hex) : null,
    time_ms: Math.max(0, Number(row.time_ms) || 0)
  }));
  const payload = { best: entries[0] || null, entries };
  leaderboardByTrack.set(key, payload);
  return payload;
}

export async function submitTrackTime(trackId, user, timeMs, car) {
  const key = normaliseTrackId(trackId);
  if (!leaderboardAvailable) return false;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session || !session.user) {
    console.info('Leaderboard submit skipped: sign in required.');
    return false;
  }

  const { error } = await supabase.from(LEADERBOARD_TABLE).insert({
    track_id: key,
    user_id: sanitizeUserId(user.user_id),
    username: sanitizeLeaderboardName(user.name),
    car_name: String(car?.name || '').trim().slice(0, 30) || null,
    car_hex: /^#[0-9a-f]{6}$/i.test(String(car?.hex || '')) ? String(car.hex).toLowerCase() : null,
    time_ms: Math.round(Math.max(0, timeMs || 0) * 1000)
  });
  if (error) {
    console.error('Leaderboard submit error:', error);
    const msg = String(error.message || '').toLowerCase();
    const authBlocked = msg.includes('row-level security') || msg.includes('permission denied');
    if (!authBlocked) leaderboardAvailable = false;
    return false;
  }
  return true;
}

export async function handlePostRaceLeaderboard(notify) {
  if (currentRaceSubmitted || !state.trkData || !state.pCar || !state.pCar.finTime || !Number.isFinite(state.pCar.finTime)) return;
  currentRaceSubmitted = true;
  const user = await loadArcadeUser();
  const ok = await submitTrackTime(state.trkData.id, user, state.pCar.finTime, state.pCar.data);
  if (ok) {
    const latest = await loadTrackLeaderboard(state.trkData.id, { force: true, limit: 10 });
    renderResultsLeaderboard(latest.entries, user.name);
    updateTrackCardBestTime(state.trkData.id);
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
  const data = await loadTrackLeaderboard(trackId, { force: true, limit: 50 });
  renderLeaderboardRows(list, data.entries);
}

export function closeTrackLeaderboardModal() {
  const modal = document.getElementById('leaderboardModal');
  if (!modal) return;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
}