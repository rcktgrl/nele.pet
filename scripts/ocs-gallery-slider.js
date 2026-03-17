/**
 * ocs-gallery-slider.js
 *
 * Drives the OC (original character) artwork slider on the homepage.
 * Visitors can step through the gallery using the prev/next buttons, or by
 * clicking the left or right half of the image directly.
 *
 * The slider reads its artwork list from gallery-data.js so the two gallery
 * surfaces (homepage slider and full gallery page) always share the same data.
 */

import { galleryArtworks } from './gallery-data.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clamp an arbitrary index so it always falls within the artwork array.
 * Negative values wrap around to the end of the list.
 *
 * @param {number} index - The raw index to normalise.
 * @returns {number} A valid index in the range [0, galleryArtworks.length).
 */
function clampIndex(index) {
  if (!galleryArtworks.length) {
    return 0;
  }

  const mod = index % galleryArtworks.length;

  // JavaScript's % can return negative values for negative operands, so
  // we add the length to bring those back into the valid range.
  return mod < 0 ? mod + galleryArtworks.length : mod;
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Mount the OC gallery slider onto the DOM and return a cleanup function.
 * The cleanup function removes all event listeners so the slider can be
 * safely torn down when the page unloads.
 *
 * @returns {() => void} A function that detaches all listeners.
 */
export function initOcsGallerySlider() {
  // Locate the slider container and its child elements via data attributes
  // so the HTML structure can change without breaking this script.
  const slider     = document.querySelector('[data-gallery-slider]');
  const imageEl    = slider?.querySelector('[data-gallery-image]');
  const captionEl  = slider?.querySelector('[data-gallery-caption]');
  const prevButton = slider?.querySelector('[data-gallery-prev]');
  const nextButton = slider?.querySelector('[data-gallery-next]');

  // If any required element is missing, return a no-op cleanup immediately.
  if (!slider || !imageEl || !captionEl || galleryArtworks.length === 0) {
    return () => {};
  }

  /** The index of the artwork currently displayed in the slider. */
  let currentIndex = 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  /**
   * Update the image and caption to reflect the current index.
   * Always clamps the index before reading from the array so out-of-range
   * values are handled gracefully.
   */
  function render() {
    const artwork    = galleryArtworks[clampIndex(currentIndex)];
    imageEl.src      = artwork.src;
    imageEl.alt      = artwork.alt;
    captionEl.textContent = artwork.caption;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /** Move one step backward and re-render. */
  function showPrevious() {
    currentIndex = clampIndex(currentIndex - 1);
    render();
  }

  /** Move one step forward and re-render. */
  function showNext() {
    currentIndex = clampIndex(currentIndex + 1);
    render();
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  /**
   * Handle a click directly on the image.
   * Clicking the left half steps backward; clicking the right half steps forward.
   *
   * @param {MouseEvent} event
   */
  function handleImageClick(event) {
    const midpoint = imageEl.clientWidth / 2;
    const clickX   = event.offsetX;

    if (clickX <= midpoint) {
      showPrevious();
    } else {
      showNext();
    }
  }

  // ---------------------------------------------------------------------------
  // Binding
  // ---------------------------------------------------------------------------

  prevButton?.addEventListener('click', showPrevious);
  nextButton?.addEventListener('click', showNext);
  imageEl.addEventListener('click', handleImageClick);

  // Show the first artwork straight away.
  render();

  // Return a cleanup function so index.js can remove listeners on unload.
  return () => {
    prevButton?.removeEventListener('click', showPrevious);
    nextButton?.removeEventListener('click', showNext);
    imageEl.removeEventListener('click', handleImageClick);
  };
}
