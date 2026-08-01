/**
 * server-status.js
 *
 * Polls status.nele.pet for the KSP, Matrix, and BeamMP server states and
 * reflects them as coloured dots in the homepage header.
 *
 * Also wires up the KSP status button so clicking it opens a confirmation
 * modal that downloads the GameData.zip modpack — the exact mod set
 * (MechJeb2 + Kerbal Engineer Redux) enforced by the server's
 * LMPModControl.xml.
 */

const POLL_INTERVAL_MS = 30000;

const STATUS_URL = 'https://status.nele.pet/status.json';

const MODPACK_URL = 'https://dl.nele.pet/GameData.zip';

function setDotState(dotElement, isOnline) {
  if (!dotElement) return;
  dotElement.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
}

async function refreshServerStatus(kspDot, matrixDot, beammpDot) {
  try {
    const response = await fetch(STATUS_URL, { cache: 'no-store' });
    const data = await response.json();
    setDotState(kspDot, data.lmp === 'online');
    setDotState(matrixDot, data.matrix === 'online');
    setDotState(beammpDot, data.beammp === 'online');
  } catch {
    setDotState(kspDot, false);
    setDotState(matrixDot, false);
    setDotState(beammpDot, false);
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
  const handleDownload = () => {
    closeModal(kspModal, kspButton);
    triggerDownload(MODPACK_URL);
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
 * @param {HTMLElement}         [options.beammpDot]       - Status dot for the BeamMP server.
 * @param {HTMLElement}         [options.kspButton]       - Clickable KSP status button.
 * @param {HTMLElement}         [options.kspModal]        - KSP download modal element.
 * @param {HTMLElement}         [options.kspDownloadButton] - Confirm download button in modal.
 * @param {HTMLElement}         [options.kspCancelButton]   - Cancel button in modal.
 * @returns {() => void} Cleanup function.
 */
export function initServerStatus({ kspDot, matrixDot, beammpDot, kspButton, kspModal, kspDownloadButton, kspCancelButton }) {
  refreshServerStatus(kspDot, matrixDot, beammpDot);

  const intervalId = setInterval(() => {
    refreshServerStatus(kspDot, matrixDot, beammpDot);
  }, POLL_INTERVAL_MS);

  const cleanupModal = initKspModal({ kspButton, kspModal, kspDownloadButton, kspCancelButton });

  return () => {
    clearInterval(intervalId);
    cleanupModal();
  };
}
