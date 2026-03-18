import { supabase } from './supabase.js';
import { sanitizeUserId, sanitizeLeaderboardName, loadArcadeUser } from './user.js';
import { state } from './state.js';
import { fmtT } from './utils/format.js';

const LEADERBOARD_TABLE_CANDIDATES = [
  'turborace_leaderboard',
  'turboracing_exp_leaderboard',
];

export const leaderboardByTrack = new Map();
export let leaderboardAvailable = true;
let activeLeaderboardTable = LEADERBOARD_TABLE_CANDIDATES[0];
let currentRaceSubmitted = false;

function isMissingRelationError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('does not exist') || message.includes('relation') && message.includes('not found');
}

async function runLeaderboardQuery(buildQuery) {
  let lastError = null;

  for (const tableName of [activeLeaderboardTable, ...LEADERBOARD_TABLE_CANDIDATES.filter((name) => name !== activeLeaderboardTable)]) {
    const result = await buildQuery(tableName);

    if (!result.error) {
      activeLeaderboardTable = tableName;
      return result;
    }

    lastError = result.error;
    if (!isMissingRelationError(result.error)) {
      break;
    }
  }

  return { data: null, error: lastError };
}

function sanitizeGhostFrame(frame) {
  if (!frame || typeof frame !== 'object') return null;

  const nextFrame = {
    t: Math.round(Number(frame.t)),
    x: Number(frame.x),
    y: Number(frame.y),
    z: Number(frame.z),
    h: Number(frame.h),
  };

  return Object.values(nextFrame).every(Number.isFinite) ? nextFrame : null;
}

function sanitizeGhostData(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const carData = raw.carData && typeof raw.carData === 'object' ? { ...raw.carData } : null;
  const frames = Array.isArray(raw.frames) ? raw.frames.map(sanitizeGhostFrame).filter(Boolean) : [];
  if (!carData || frames.length < 2) return null;

  return {
    username: sanitizeLeaderboardName(raw.username),
    carData,
    frames,
    timeMs: Math.max(0, Number(raw.timeMs) || 0),
  };
}

function normaliseLeaderboardRow(row) {
  return {
    id: row.id,
    track_id: String(row.track_id || ''),
    user_id: sanitizeUserId(row.user_id),
    username: sanitizeLeaderboardName(row.username),
    car_name: String(row.car_name || '').trim().slice(0, 30),
    car_hex: /^#[0-9a-f]{6}$/i.test(String(row.car_hex || '')) ? String(row.car_hex).toLowerCase() : null,
    time_ms: Math.max(0, Number(row.time_ms) || 0),
    ghost_data: sanitizeGhostData(row.ghost_data),
  };
}

function sortLeaderboardEntries(entries) {
  return [...entries].sort((left, right) => leaderboardComparableTimeMs(left.time_ms) - leaderboardComparableTimeMs(right.time_ms));
}

function buildLeaderboardPayload(rows) {
  const entries = sortLeaderboardEntries((rows || []).map(normaliseLeaderboardRow));
  return { best: entries[0] || null, entries };
}

export function isCurrentRaceSubmitted() {
  return currentRaceSubmitted;
}

export function resetCurrentRaceSubmitted() {
  currentRaceSubmitted = false;
}

export function markCurrentRaceSubmitted() {
  currentRaceSubmitted = true;
}

export function normaliseTrackId(trackId, trackName = '') {
  const rawId = trackId === null || trackId === undefined || trackId === '' ? 'unknown' : String(trackId);
  const slug = String(trackName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return slug ? `${rawId}:${slug}` : rawId;
}

function getTrackIdCandidates(trackId, trackName = '') {
  const preferred = normaliseTrackId(trackId, trackName);
  const rawId = trackId === null || trackId === undefined || trackId === '' ? 'unknown' : String(trackId);
  return [...new Set([preferred, rawId])];
}

export function leaderboardTimeToSeconds(timeMs) {
  const numeric = Math.max(0, Number(timeMs) || 0);
  return numeric < 1000 ? numeric : numeric / 1000;
}

function leaderboardComparableTimeMs(timeMs) {
  const numeric = Math.max(0, Number(timeMs) || 0);
  return numeric < 1000 ? Math.round(numeric * 1000) : Math.round(numeric);
}

function formatLeaderboardTime(timeMs) {
  return fmtT(leaderboardTimeToSeconds(timeMs));
}

function buildLeaderboardEmptyState() {
  return '<div class="lb-empty">No leaderboard entries yet for this track.</div>';
}

function buildGhostMarker(entry) {
  return entry.ghost_data
    ? '<span class="lb-ghost-marker" title="Ghost data available" aria-label="Ghost data available">👻</span>'
    : '';
}

function buildCarLabel(entry) {
  return entry.car_name
    ? `<div class="lb-car"><span class="lb-car-dot" style="background:${entry.car_hex || '#fff'}"></span>${entry.car_name}</div>`
    : '';
}

export function renderLeaderboardRows(container, entries, highlightName) {
  if (!container) return;
  if (!entries?.length) {
    container.innerHTML = buildLeaderboardEmptyState();
    return;
  }

  container.innerHTML = '';
  entries.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = `lb-row${highlightName && entry.username === highlightName ? ' lb-row-you' : ''}`;
    row.innerHTML = `<span class="lb-pos">${index + 1}</span><span class="lb-name">${entry.username}${buildGhostMarker(entry)}${buildCarLabel(entry)}</span><span class="lb-time">${formatLeaderboardTime(entry.time_ms)}</span>`;
    container.appendChild(row);
  });
}

export function renderResultsLeaderboard(entries, highlightName) {
  renderLeaderboardRows(document.getElementById('resultsLeaderboard'), entries, highlightName);
}

export function updateTrackCardBestTime(trackId, trackName = '') {
  const key = normaliseTrackId(trackId, trackName);
  const bestTimeElement = document.querySelector(`[data-track-best="${CSS.escape(key)}"]`);
  if (!bestTimeElement) return;

  const leaderboardData = leaderboardByTrack.get(key);
  if (!leaderboardAvailable) bestTimeElement.textContent = 'Best: leaderboard unavailable';
  else if (!leaderboardData?.best) bestTimeElement.textContent = 'Best: --';
  else bestTimeElement.textContent = `Best: ${formatLeaderboardTime(leaderboardData.best.time_ms)} · ${leaderboardData.best.username}`;
}

async function fetchLeaderboardRows(trackIds, limit) {
  const result = await runLeaderboardQuery((tableName) => supabase.from(tableName)
    .select('*')
    .in('track_id', trackIds)
    .order('time_ms', { ascending: true })
    .limit(limit));

  if (result.error) {
    console.error('Leaderboard fetch error:', result.error);
    leaderboardAvailable = false;
    return [];
  }

  return result.data || [];
}

export async function loadTrackLeaderboard(trackId, { force = false, limit = 10, trackName = '' } = {}) {
  const trackIds = getTrackIdCandidates(trackId, trackName);
  const cacheKey = trackIds[0];

  if (!leaderboardAvailable) return { best: null, entries: [] };
  if (!force && leaderboardByTrack.has(cacheKey)) return leaderboardByTrack.get(cacheKey);

  const payload = buildLeaderboardPayload(await fetchLeaderboardRows(trackIds, limit));
  leaderboardByTrack.set(cacheKey, payload);
  return payload;
}

function createSubmissionPayload(trackIds, user, timeSeconds, car, ghostData) {
  return {
    track_id: trackIds[0],
    user_id: sanitizeUserId(user.user_id),
    username: sanitizeLeaderboardName(user.name),
    car_name: String(car?.name || '').trim().slice(0, 30) || null,
    car_hex: /^#[0-9a-f]{6}$/i.test(String(car?.hex || '')) ? String(car.hex).toLowerCase() : null,
    time_ms: Math.round(Math.max(0, timeSeconds || 0) * 1000),
    ghost_data: sanitizeGhostData(ghostData),
  };
}

async function fetchExistingUserRows(trackIds, userId) {
  const result = await runLeaderboardQuery((tableName) => supabase.from(tableName)
    .select('id,time_ms,track_id')
    .in('track_id', trackIds)
    .eq('user_id', userId));

  if (result.error) {
    console.error('Leaderboard existing row lookup error:', result.error);
    return null;
  }

  return Array.isArray(result.data) ? result.data : [];
}

async function insertLeaderboardRow(payload) {
  return runLeaderboardQuery((tableName) => supabase.from(tableName).insert(payload));
}

async function updateLeaderboardRow(rowId, payload) {
  return runLeaderboardQuery((tableName) => supabase.from(tableName).update(payload).eq('id', rowId));
}

async function deleteLeaderboardRows(rowIds) {
  if (!rowIds.length) return { error: null };
  return runLeaderboardQuery((tableName) => supabase.from(tableName).delete().in('id', rowIds));
}

async function keepFastestRowOnly(trackIds, userId) {
  const result = await runLeaderboardQuery((tableName) => supabase.from(tableName)
    .select('id,time_ms')
    .in('track_id', trackIds)
    .eq('user_id', userId)
    .order('time_ms', { ascending: true }));

  if (result.error) {
    console.error('Leaderboard post-write verify error:', result.error);
    return false;
  }

  const rows = Array.isArray(result.data) ? result.data : [];
  const staleIds = rows.slice(1).map((row) => row.id);
  if (!staleIds.length) return true;

  const deleteResult = await deleteLeaderboardRows(staleIds);
  if (deleteResult.error) {
    console.error('Leaderboard cleanup delete error:', deleteResult.error);
    return false;
  }

  return true;
}

function canSubmitTime(session) {
  if (!leaderboardAvailable) return false;
  if (!session?.user) {
    console.info('Leaderboard submit skipped: sign in required.');
    return false;
  }
  return true;
}

export async function submitTrackTime(trackId, user, timeSeconds, car, ghostData = null, trackName = '') {
  const { data: { session } } = await supabase.auth.getSession();
  if (!canSubmitTime(session)) return false;

  const trackIds = getTrackIdCandidates(trackId, trackName);
  const sessionUser = session.user;
  const safeUser = {
    user_id: sanitizeUserId(sessionUser.id) || sanitizeUserId(user.user_id),
    name: sanitizeLeaderboardName(user.name || sessionUser.user_metadata?.username || sessionUser.email?.split('@')[0] || 'Player'),
  };

  const payload = createSubmissionPayload(trackIds, safeUser, timeSeconds, car, ghostData);
  const existingRows = await fetchExistingUserRows(trackIds, safeUser.user_id);
  if (existingRows === null) return false;

  const fastestRow = existingRows.reduce((best, row) => {
    if (!best) return row;
    return leaderboardComparableTimeMs(row.time_ms) < leaderboardComparableTimeMs(best.time_ms) ? row : best;
  }, null);

  const improvesBest = !fastestRow || payload.time_ms < leaderboardComparableTimeMs(fastestRow.time_ms);
  let writeResult = { error: null };

  if (!fastestRow) {
    writeResult = await insertLeaderboardRow(payload);
  } else if (improvesBest) {
    writeResult = await updateLeaderboardRow(fastestRow.id, payload);
  }

  if (writeResult.error) {
    console.error('Leaderboard submit error:', writeResult.error);
    const authBlocked = String(writeResult.error.message || '').toLowerCase().includes('row-level security')
      || String(writeResult.error.message || '').toLowerCase().includes('permission denied');
    if (!authBlocked) leaderboardAvailable = false;
    return false;
  }

  const staleRows = existingRows.filter((row) => row.id !== fastestRow?.id);
  if (staleRows.length) {
    const deleteResult = await deleteLeaderboardRows(staleRows.map((row) => row.id));
    if (deleteResult.error) {
      console.error('Leaderboard stale row cleanup error:', deleteResult.error);
      return false;
    }
  }

  return keepFastestRowOnly(trackIds, safeUser.user_id);
}

function getCurrentTrackLeaderboardKey() {
  return normaliseTrackId(state.trkData?.id, state.trkData?.name);
}

export async function handlePostRaceLeaderboard(notify, ghostData = null) {
  if (currentRaceSubmitted || !state.trkData || !state.pCar?.finTime || !Number.isFinite(state.pCar.finTime)) return;

  currentRaceSubmitted = true;
  const user = await loadArcadeUser();
  const submitted = await submitTrackTime(state.trkData.id, user, state.pCar.finTime, state.pCar.data, ghostData, state.trkData.name);
  const latest = await loadTrackLeaderboard(state.trkData.id, { force: true, limit: 10, trackName: state.trkData.name });

  renderResultsLeaderboard(latest.entries, user.name);
  updateTrackCardBestTime(state.trkData.id, state.trkData.name);
  notify(submitted ? 'Leaderboard time saved!' : 'Leaderboard submit skipped (sign in required).');
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

export function getCurrentTrackLeaderboard() {
  return leaderboardByTrack.get(getCurrentTrackLeaderboardKey()) || { best: null, entries: [] };
}
