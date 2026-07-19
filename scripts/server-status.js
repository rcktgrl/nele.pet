/**
 * server-status.js
 *
 * Polls status.nele.pet for the LMP and Matrix server states and reflects
 * them as coloured dots in the homepage header.
 */

/** How often to re-check server status, in milliseconds. */
const POLL_INTERVAL_MS = 30000;

/** Endpoint that reports current server states. */
const STATUS_URL = 'https://status.nele.pet/status.json';

/**
 * Apply an online/offline class to a status dot element.
 *
 * @param {HTMLElement|null} dotElement
 * @param {boolean} isOnline
 */
function setDotState(dotElement, isOnline) {
  if (!dotElement) {
    return;
  }

  dotElement.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
}

/**
 * Fetch the latest status and update both dots. Falls back to offline for
 * both services if the request fails (e.g. the status host is unreachable).
 *
 * @param {HTMLElement|null} lmpDot
 * @param {HTMLElement|null} matrixDot
 */
async function refreshServerStatus(lmpDot, matrixDot) {
  try {
    const response = await fetch(STATUS_URL, { cache: 'no-store' });
    const data = await response.json();

    setDotState(lmpDot, data.lmp === 'online');
    setDotState(matrixDot, data.matrix === 'online');
  } catch {
    setDotState(lmpDot, false);
    setDotState(matrixDot, false);
  }
}

/**
 * Initialise the server status indicator and return a cleanup function.
 *
 * @param {object}          options
 * @param {HTMLElement}     options.lmpDot    - Status dot for the LMP server.
 * @param {HTMLElement}     options.matrixDot - Status dot for the Matrix server.
 * @returns {() => void} A cleanup function that stops the polling interval.
 */
export function initServerStatus({ lmpDot, matrixDot }) {
  refreshServerStatus(lmpDot, matrixDot);

  const intervalId = setInterval(() => {
    refreshServerStatus(lmpDot, matrixDot);
  }, POLL_INTERVAL_MS);

  return () => {
    clearInterval(intervalId);
  };
}
