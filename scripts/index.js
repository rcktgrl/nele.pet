import { initAudioControls } from './audio-controls.js';
import { initCookieConsent } from './cookie-consent.js';
import { initHeroSlider } from './hero-slider.js';
import { initPawprints } from './pawprints.js';
import { initOcsGallerySlider } from './ocs-gallery-slider.js';
import { galleryArtworks } from './gallery-data.js';

// Each init function returns a cleanup callback so we can tidy up on unload.
const heroCleanup = initHeroSlider({
  sliderElement: document.querySelector('.hero-layer__slider'),
  nextButton: null,
  images: galleryArtworks,
});

const ocsGalleryCleanup = initOcsGallerySlider();

const cookieCleanup = initCookieConsent({
  popup: document.getElementById('cookie-popup'),
  acceptButton: document.getElementById('cookie-yes'),
  rejectButton: document.getElementById('cookie-no'),
  infoButton: document.getElementById('cookie-info-button'),
  infoModal: document.getElementById('cookie-info-modal'),
  infoCloseButton: document.getElementById('cookie-info-close'),
  bearButton: document.getElementById('cookie-bear-button'),
  body: document.body,
});

const audioCleanup = initAudioControls({
  barkAudio: document.getElementById('bark-sound'),
  barkTestButton: document.getElementById('bark-test'),
  volumeSlider: document.getElementById('volume-control'),
  volumeLabel: document.getElementById('volume-label'),
  volumeIcon: document.getElementById('volume-icon'),
});

const pawprintsCleanup = initPawprints({
  nameInput: document.getElementById('paw-name'),
  messageInput: document.getElementById('paw-input'),
  submitButton: document.getElementById('paw-submit'),
  feedbackElement: document.getElementById('paw-feedback'),
  listElement: document.getElementById('paw-prints'),
  openButton: document.getElementById('paw-open'),
  closeButton: document.getElementById('paw-close'),
  panelElement: document.getElementById('paw-panel'),
});

window.addEventListener('beforeunload', () => {
  heroCleanup?.();
  cookieCleanup?.();
  audioCleanup?.();
  pawprintsCleanup?.();
  ocsGalleryCleanup?.();
});
