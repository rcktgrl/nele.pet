/**
 * gallery-page.js
 *
 * Renders the full artwork gallery grid and drives the lightbox overlay.
 * Clicking a thumbnail opens the lightbox; arrow keys and the prev/next
 * buttons let the visitor step through the collection without closing it.
 *
 * The page background image also updates to match the open artwork,
 * creating a subtle atmospheric effect.
 */

import { galleryArtworks } from './gallery-data.js';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const grid            = document.getElementById('gallery-grid');
const lightbox        = document.getElementById('lightbox');
const lightboxImage   = document.getElementById('lightbox-image');
const lightboxCaption = document.getElementById('lightbox-caption');
const lightboxClose   = document.getElementById('lightbox-close');
const previousButton  = document.getElementById('lightbox-prev');
const nextButton      = document.getElementById('lightbox-next');

/** The full-page canvas element whose background mirrors the open artwork. */
const backgroundCanvas = document.querySelector('.background-canvas');

/**
 * The default CSS background-image on the canvas, captured once at startup
 * so we can restore it after the lightbox closes.
 */
const defaultBackground = backgroundCanvas
  ? getComputedStyle(backgroundCanvas).backgroundImage
  : '';

/** Index of the artwork currently shown in the lightbox, or -1 when closed. */
let currentIndex = -1;

// ---------------------------------------------------------------------------
// Background helpers
// ---------------------------------------------------------------------------

/**
 * Set the full-page background canvas to show a blurred, tinted version of
 * the given artwork. Pass null to restore the original default background.
 *
 * @param {object|null} artwork - An entry from galleryArtworks, or null.
 */
function setBackgroundForArtwork(artwork) {
  if (!backgroundCanvas) {
    return;
  }

  if (artwork) {
    // Overlay a dark gradient so page content stays readable.
    backgroundCanvas.style.backgroundImage =
      `linear-gradient(120deg, rgba(14, 2, 28, 0.72), rgba(18, 6, 42, 0.62)), url(${artwork.src})`;
    backgroundCanvas.style.backgroundSize     = 'cover';
    backgroundCanvas.style.backgroundPosition = 'center';
    backgroundCanvas.style.backgroundRepeat   = 'no-repeat';
  } else {
    // Reset every property so the original CSS background takes over again.
    backgroundCanvas.style.backgroundImage    = defaultBackground;
    backgroundCanvas.style.backgroundSize     = '';
    backgroundCanvas.style.backgroundPosition = '';
    backgroundCanvas.style.backgroundRepeat   = '';
  }
}

// ---------------------------------------------------------------------------
// Lightbox open / close
// ---------------------------------------------------------------------------

/**
 * Open the lightbox and display the given artwork.
 *
 * @param {object} artwork - An entry from galleryArtworks.
 * @param {number} index   - The position of this artwork in the array.
 */
function openLightbox(artwork, index) {
  if (!artwork) {
    return;
  }

  currentIndex = index;
  lightboxImage.src         = artwork.src;
  lightboxImage.alt         = artwork.alt;
  lightboxCaption.textContent = artwork.caption;

  lightbox?.classList.add('open');
  setBackgroundForArtwork(artwork);
}

/**
 * Close the lightbox, clear the displayed image, and restore the background.
 */
function closeLightbox() {
  lightbox?.classList.remove('open');
  lightboxImage.src = '';
  setBackgroundForArtwork(null);
  currentIndex = -1;
}

/**
 * Move to the next or previous artwork while the lightbox is open.
 * The index wraps around so the collection feels circular.
 *
 * @param {number} step - Use +1 to go forward, -1 to go backward.
 */
function navigateLightbox(step) {
  if (currentIndex < 0) {
    return;
  }

  // Wrap around both ends using modulo on the total artwork count.
  const nextIndex = (currentIndex + step + galleryArtworks.length) % galleryArtworks.length;
  const artwork   = galleryArtworks[nextIndex];

  openLightbox(artwork, nextIndex);
}

// ---------------------------------------------------------------------------
// Grid rendering
// ---------------------------------------------------------------------------

/**
 * Build the gallery grid by creating one button tile per artwork and
 * appending them all into the grid container.
 */
function renderGrid() {
  if (!grid) {
    return;
  }

  galleryArtworks.forEach((artwork, index) => {
    // Each tile is a focusable button so keyboard users can reach it.
    const tile     = document.createElement('button');
    tile.className = 'gallery-grid__item';
    tile.type      = 'button';
    tile.setAttribute('aria-label', `Open ${artwork.caption}`);

    // Lazy-load the thumbnails so the page does not request every image upfront.
    const thumb     = document.createElement('img');
    thumb.src       = artwork.src;
    thumb.alt       = artwork.alt;
    thumb.loading   = 'lazy';

    const label           = document.createElement('span');
    label.className       = 'gallery-grid__label';
    label.textContent     = artwork.caption;

    tile.appendChild(thumb);
    tile.appendChild(label);

    // Capture index in closure so the correct artwork opens on click.
    tile.addEventListener('click', () => openLightbox(artwork, index));

    grid.appendChild(tile);
  });
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/** Close the lightbox when the visitor clicks the close button. */
function handleCloseClick() {
  closeLightbox();
}

/** Step backward through the gallery. */
function handlePreviousClick() {
  navigateLightbox(-1);
}

/** Step forward through the gallery. */
function handleNextClick() {
  navigateLightbox(1);
}

/**
 * Close the lightbox when the visitor clicks the dark backdrop around the
 * image (but not the image itself).
 *
 * @param {MouseEvent} event
 */
function handleLightboxBackdropClick(event) {
  if (event.target === lightbox) {
    closeLightbox();
  }
}

/**
 * Handle keyboard shortcuts while the lightbox is open:
 *   Escape     → close
 *   ArrowRight → next artwork
 *   ArrowLeft  → previous artwork
 *
 * @param {KeyboardEvent} event
 */
function handleKeydown(event) {
  if (!lightbox?.classList.contains('open')) {
    return;
  }

  if (event.key === 'Escape') {
    closeLightbox();
  } else if (event.key === 'ArrowRight') {
    navigateLightbox(1);
  } else if (event.key === 'ArrowLeft') {
    navigateLightbox(-1);
  }
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

// Build the grid immediately so thumbnails appear as soon as the script runs.
renderGrid();

// Wire up all interactive controls.
lightboxClose?.addEventListener('click', handleCloseClick);
previousButton?.addEventListener('click', handlePreviousClick);
nextButton?.addEventListener('click', handleNextClick);
lightbox?.addEventListener('click', handleLightboxBackdropClick);
document.addEventListener('keydown', handleKeydown);
