/**
 * index.js
 *
 * Entry point for the nele.pet homepage. Imports and initialises every
 * interactive subsystem on the page, then registers cleanup callbacks that
 * run when the visitor navigates away.
 *
 * Each init function is responsible for its own DOM wiring and returns a
 * teardown callback so this file stays a simple coordinator rather than
 * duplicating any logic.
 */

import { initAudioControls }    from './audio-controls.js';
import { initCookieConsent }    from './cookie-consent.js';
import { initHeroSlider }       from './hero-slider.js';
import { initPawprints }        from './pawprints.js';
import { initOcsGallerySlider } from './ocs-gallery-slider.js';
import { galleryArtworks }      from './gallery-data.js';

// ---------------------------------------------------------------------------
// Hero slider
// Rotates the large background artwork. Uses the same artwork list as the
// full gallery page so the two surfaces stay in sync automatically.
// ---------------------------------------------------------------------------

const heroCleanup = initHeroSlider({
  sliderElement: document.querySelector('.hero-layer__slider'),
  nextButton:    null, // No manual next button on the homepage hero.
  images:        galleryArtworks,
});

// ---------------------------------------------------------------------------
// OC gallery slider
// The small artwork preview slider in the body of the homepage.
// ---------------------------------------------------------------------------

const ocsGalleryCleanup = initOcsGallerySlider();

// ---------------------------------------------------------------------------
// Cookie consent
// Shows the consent popup on first visit and manages the stored preference.
// ---------------------------------------------------------------------------

const cookieCleanup = initCookieConsent({
  popup:          document.getElementById('cookie-popup'),
  acceptButton:   document.getElementById('cookie-yes'),
  rejectButton:   document.getElementById('cookie-no'),
  infoButton:     document.getElementById('cookie-info-button'),
  infoModal:      document.getElementById('cookie-info-modal'),
  infoCloseButton: document.getElementById('cookie-info-close'),
  bearButton:     document.getElementById('cookie-bear-button'),
  body:           document.body,
});

// ---------------------------------------------------------------------------
// Audio controls
// Site-wide bark sound that plays on button/link interactions, plus volume.
// ---------------------------------------------------------------------------

const audioCleanup = initAudioControls({
  barkAudio:    document.getElementById('bark-sound'),
  barkTestButton: document.getElementById('bark-test'),
  volumeSlider: document.getElementById('volume-control'),
  volumeLabel:  document.getElementById('volume-label'),
  volumeIcon:   document.getElementById('volume-icon'),
});

// ---------------------------------------------------------------------------
// Paw prints guestbook
// Panel where visitors can leave a short message stored in Supabase.
// ---------------------------------------------------------------------------

const pawprintsCleanup = initPawprints({
  nameInput:       document.getElementById('paw-name'),
  messageInput:    document.getElementById('paw-input'),
  submitButton:    document.getElementById('paw-submit'),
  feedbackElement: document.getElementById('paw-feedback'),
  listElement:     document.getElementById('paw-prints'),
  openButton:      document.getElementById('paw-open'),
  closeButton:     document.getElementById('paw-close'),
  panelElement:    document.getElementById('paw-panel'),
});

// ---------------------------------------------------------------------------
// Teardown
// Run all cleanup functions when the visitor leaves the page so event
// listeners are removed and nothing leaks into the next navigation.
// ---------------------------------------------------------------------------

window.addEventListener('beforeunload', () => {
  heroCleanup?.();
  cookieCleanup?.();
  audioCleanup?.();
  pawprintsCleanup?.();
  ocsGalleryCleanup?.();
});
