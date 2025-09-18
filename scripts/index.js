// Bootstraps all interactive modules that power the landing page.
import { initAudioControls } from './audioControls.js';
import { initCookieConsent } from './cookieConsent.js';
import { initHeroSlider } from './heroSlider.js';
import { initPawprints } from './pawprints.js';

const heroImages = [
  { src: 'Untitled_Artwork.jpeg', alt: 'Pastel illustration of Pumpkin and Nyx snuggling amongst pillows.' },
  { src: 'Pumpkin and Nyx.jpg', alt: 'Pumpkin and Nyx cuddling together on a cozy sofa.' },
];

// Each init function returns a cleanup callback so we can tidy up on unload.
const heroCleanup = initHeroSlider({
  sliderElement: document.querySelector('.hero-layer__slider'),
  nextButton: document.getElementById('next-background'),
  images: heroImages,
});

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
});
