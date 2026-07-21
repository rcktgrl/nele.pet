/**
 * server-status.js
 *
 * Polls status.nele.pet for the KSP and Matrix server states and reflects
 * them as coloured dots in the homepage header.
 *
 * Also wires up the KSP status button so clicking it opens a confirmation
 * modal that triggers mod downloads (MechJeb2 + Kerbal Engineer Redux).
 */

const POLL_INTERVAL_MS = 30000;

const STATUS_URL = 'https://status.nele.pet/status.json';

const MECHJEB_JENKINS_BASE = 'https://ksp.sarbian.com/jenkins/job/MechJeb2-Release';
const MECHJEB_FALLBACK_URL = `${MECHJEB_JENKINS_BASE}/45/artifact/MechJeb2-2.15.1.0.zip`;
const KER_RELEASES_API = 'https://api.github.com/repos/jrbudda/KerbalEngineer/releases/latest';

function setDotState(dotElement, isOnline) {
  if (!dotElement) return;
  dotElement.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
}

async function refreshServerStatus(kspDot, matrixDot) {
  try {
    const response = await fetch(STATUS_URL, { cache: 'no-store' });
    const data = await response.json();
    setDotState(kspDot, data.lmp === 'online');
    setDotState(matrixDot, data.matrix === 'online');
  } catch {
    setDotState(kspDot, false);
    setDotState(matrixDot, false);
  }
}

async function getMechJebUrl() {
  try {
    const res = await fetch(`${MECHJEB_JENKINS_BASE}/lastSuccessfulBuild/api/json`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('non-ok');
    const data = await res.json();
    const artifact = data.artifacts?.find(a => a.fileName.endsWith('.zip'));
    if (artifact) {
      return `${MECHJEB_JENKINS_BASE}/lastSuccessfulBuild/artifact/${artifact.relativePath}`;
    }
  } catch {
    // fall through to pinned fallback
  }
  return MECHJEB_FALLBACK_URL;
}

async function getKerUrl() {
  try {
    const res = await fetch(KER_RELEASES_API, { cache: 'no-store' });
    if (!res.ok) throw new Error('non-ok');
    const data = await res.json();
    return data.assets?.find(a => a.name.endsWith('.zip'))?.browser_download_url ?? null;
  } catch {
    return null;
  }
}

function triggerDownload(url) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function openModal(modal) {
  modal.removeAttribute('aria-hidden');
  modal.classList.add('open');
  modal.querySelector('button, [tabindex]')?.focus();
}

function closeModal(modal, returnFocusTo) {
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('open');
  returnFocusTo?.focus();
}

function initKspModal({ kspButton, kspModal, kspDownloadButton, kspCancelButton }) {
  if (!kspButton || !kspModal) return () => {};

  const handleOpen = () => openModal(kspModal);
  const handleCancel = () => closeModal(kspModal, kspButton);
  const handleBackdrop = (e) => {
    if (e.target === kspModal) closeModal(kspModal, kspButton);
  };
  const handleKeydown = (e) => {
    if (e.key === 'Escape' && kspModal.classList.contains('open')) {
      closeModal(kspModal, kspButton);
    }
  };
  const handleDownload = async () => {
    closeModal(kspModal, kspButton);
    if (kspDownloadButton) kspDownloadButton.disabled = true;
    const [mechJebUrl, kerUrl] = await Promise.all([getMechJebUrl(), getKerUrl()]);
    triggerDownload(mechJebUrl);
    if (kerUrl) setTimeout(() => triggerDownload(kerUrl), 300);
    if (kspDownloadButton) kspDownloadButton.disabled = false;
  };

  kspButton.addEventListener('click', handleOpen);
  kspCancelButton?.addEventListener('click', handleCancel);
  kspDownloadButton?.addEventListener('click', handleDownload);
  kspModal.addEventListener('click', handleBackdrop);
  document.addEventListener('keydown', handleKeydown);

  return () => {
    kspButton.removeEventListener('click', handleOpen);
    kspCancelButton?.removeEventListener('click', handleCancel);
    kspDownloadButton?.removeEventListener('click', handleDownload);
    kspModal.removeEventListener('click', handleBackdrop);
    document.removeEventListener('keydown', handleKeydown);
  };
}

/**
 * Initialise the server status indicator and KSP download modal.
 *
 * @param {object}              options
 * @param {HTMLElement}         options.kspDot            - Status dot for the KSP server.
 * @param {HTMLElement}         options.matrixDot         - Status dot for the Matrix server.
 * @param {HTMLElement}         [options.kspButton]       - Clickable KSP status button.
 * @param {HTMLElement}         [options.kspModal]        - KSP download modal element.
 * @param {HTMLElement}         [options.kspDownloadButton] - Confirm download button in modal.
 * @param {HTMLElement}         [options.kspCancelButton]   - Cancel button in modal.
 * @returns {() => void} Cleanup function.
 */
export function initServerStatus({ kspDot, matrixDot, kspButton, kspModal, kspDownloadButton, kspCancelButton }) {
  refreshServerStatus(kspDot, matrixDot);

  const intervalId = setInterval(() => {
    refreshServerStatus(kspDot, matrixDot);
  }, POLL_INTERVAL_MS);

  const cleanupModal = initKspModal({ kspButton, kspModal, kspDownloadButton, kspCancelButton });

  return () => {
    clearInterval(intervalId);
    cleanupModal();
  };
}
