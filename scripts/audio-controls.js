/**
 * audio-controls.js
 *
 * Wires up the site-wide bark sound system. Every button, link-button, and
 * span on the page plays a short bark when clicked or tapped, giving the
 * site its signature interactive feel.
 *
 * The visitor's preferred volume level is remembered between visits using
 * localStorage, and a dedicated test button lets them preview the sound
 * before encountering it elsewhere.
 */

/**
 * CSS selector that describes which elements should trigger a bark.
 * Keeping it broad means new interactive elements inherit the behaviour
 * without needing any extra wiring.
 */
const INTERACTION_TARGET_SELECTOR = 'button, .link-button, span';

/** localStorage key used to persist the visitor's volume preference. */
const VOLUME_STORAGE_KEY = 'barkVolume';

// ---------------------------------------------------------------------------
// Audio playback
// ---------------------------------------------------------------------------

/**
 * Reset the audio element to the beginning and play it.
 *
 * Browsers can reject play() calls that happen before the visitor has
 * interacted with the page (the autoplay policy). We swallow those rejections
 * silently so they do not pollute the console.
 *
 * @param {HTMLAudioElement} audioElement - The audio element to play.
 */
function playBark(audioElement) {
  if (!audioElement) {
    return;
  }

  audioElement.currentTime = 0;

  const playPromise = audioElement.play();

  // play() returns a Promise in modern browsers. Guard before calling .catch()
  // since older browsers return undefined instead.
  if (playPromise?.catch) {
    playPromise.catch(() => {
      /* Autoplay was blocked — this is expected and safe to ignore. */
    });
  }
}

// ---------------------------------------------------------------------------
// Interaction handler
// ---------------------------------------------------------------------------

/**
 * Build a document-level click/touch handler that plays the bark audio
 * whenever the event target (or one of its ancestors) matches the
 * interactive element selector.
 *
 * Listening on the document rather than individual elements means the handler
 * stays effective even after new buttons are dynamically added to the page.
 *
 * @param {HTMLAudioElement} audioElement
 * @returns {(event: Event) => void}
 */
function createInteractionHandler(audioElement) {
  return (event) => {
    const target = event.target?.closest?.(INTERACTION_TARGET_SELECTOR);

    if (!target) {
      return;
    }

    playBark(audioElement);
  };
}

// ---------------------------------------------------------------------------
// Volume display
// ---------------------------------------------------------------------------

/**
 * Determine the human-readable volume label for a given numeric level.
 *
 * @param {number} volumeValue - Volume from 0 to 100.
 * @returns {string} One of 'Arf', 'Woof', or 'Bark'.
 */
function getVolumeLabel(volumeValue) {
  if (volumeValue <= 33) {
    return 'Arf';
  }

  if (volumeValue <= 66) {
    return 'Woof';
  }

  return 'Bark';
}

/**
 * Determine the speaker emoji icon for a given volume level.
 *
 * @param {number} volumeValue - Volume from 0 to 100.
 * @returns {string} One of '🔈', '🔉', or '🔊'.
 */
function getVolumeIcon(volumeValue) {
  if (volumeValue <= 33) {
    return '🔈';
  }

  if (volumeValue <= 66) {
    return '🔉';
  }

  return '🔊';
}

/**
 * Sync all volume-related UI elements to reflect the given numeric level.
 * Each parameter is optional — missing elements are silently skipped.
 *
 * @param {HTMLInputElement|null}  volumeSlider - The range input.
 * @param {HTMLElement|null}       volumeLabel  - Text label showing Arf/Woof/Bark.
 * @param {HTMLElement|null}       volumeIcon   - Emoji icon element.
 * @param {number}                 volumeValue  - Current volume, 0–100.
 */
function updateVolumeDisplay(volumeSlider, volumeLabel, volumeIcon, volumeValue) {
  if (volumeSlider) {
    volumeSlider.value = String(volumeValue);
  }

  if (volumeLabel) {
    volumeLabel.textContent = `Volume: ${getVolumeLabel(volumeValue)}`;
  }

  if (volumeIcon) {
    volumeIcon.textContent = getVolumeIcon(volumeValue);
  }
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Initialise the bark sound controls and return a cleanup function.
 *
 * Sets up:
 * - Document-level click and touch handlers that play the bark
 * - The test button so visitors can preview the sound manually
 * - The volume slider with localStorage persistence
 * - Restored volume from the visitor's last visit
 *
 * @param {object}               options
 * @param {HTMLAudioElement}     options.barkAudio       - The <audio> element.
 * @param {HTMLButtonElement}    options.barkTestButton  - Manual test button.
 * @param {HTMLInputElement}     options.volumeSlider    - Range slider (0–100).
 * @param {HTMLElement}          options.volumeLabel     - Text label element.
 * @param {HTMLElement}          options.volumeIcon      - Emoji icon element.
 * @returns {() => void} A cleanup function that removes all added listeners.
 */
export function initAudioControls({
  barkAudio,
  barkTestButton,
  volumeSlider,
  volumeLabel,
  volumeIcon,
}) {
  // Without an audio element there is nothing to set up.
  if (!barkAudio) {
    return () => {};
  }

  // Create separate handler instances for click and touch so both can be
  // cleanly removed independently during teardown.
  const handleInteraction      = createInteractionHandler(barkAudio);
  const handleTouchInteraction = createInteractionHandler(barkAudio);

  document.addEventListener('click', handleInteraction);
  document.addEventListener('touchstart', handleTouchInteraction);

  // ---------------------------------------------------------------------------
  // Test button
  // ---------------------------------------------------------------------------

  function handleTestButtonClick() {
    playBark(barkAudio);
  }

  barkTestButton?.addEventListener('click', handleTestButtonClick);

  // ---------------------------------------------------------------------------
  // Volume slider
  // ---------------------------------------------------------------------------

  function handleVolumeInput() {
    const numericValue = Number.parseInt(volumeSlider.value, 10);

    // Guard against NaN (e.g. an empty value) by falling back to 100.
    const volumeValue = Number.isFinite(numericValue)
      ? Math.max(0, Math.min(100, numericValue))
      : 100;

    // The HTMLAudioElement.volume property expects a value between 0 and 1.
    barkAudio.volume = volumeValue / 100;

    localStorage.setItem(VOLUME_STORAGE_KEY, String(volumeValue));
    updateVolumeDisplay(volumeSlider, volumeLabel, volumeIcon, volumeValue);
  }

  volumeSlider?.addEventListener('input', handleVolumeInput);

  // ---------------------------------------------------------------------------
  // Restore saved volume
  // ---------------------------------------------------------------------------

  // Read the stored preference, defaulting to 100 when nothing is saved.
  const savedVolume  = Number.parseInt(localStorage.getItem(VOLUME_STORAGE_KEY) ?? '100', 10);
  const initialVolume = Number.isFinite(savedVolume)
    ? Math.max(0, Math.min(100, savedVolume))
    : 100;

  barkAudio.volume = initialVolume / 100;
  updateVolumeDisplay(volumeSlider, volumeLabel, volumeIcon, initialVolume);

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  return () => {
    // Remove every listener that was added so nothing leaks between pages.
    document.removeEventListener('click', handleInteraction);
    document.removeEventListener('touchstart', handleTouchInteraction);
    barkTestButton?.removeEventListener('click', handleTestButtonClick);
    volumeSlider?.removeEventListener('input', handleVolumeInput);
  };
}
