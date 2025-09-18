/**
 * Elements matching this selector will trigger the bark sound when clicked
 * or tapped. The selector intentionally stays broad so that new interactive
 * elements automatically inherit the behaviour without extra wiring.
 */
const INTERACTION_TARGET_SELECTOR = 'button, .link-button, span';

/** The key used to remember the visitor's preferred bark volume in storage. */
const VOLUME_STORAGE_KEY = 'barkVolume';

/**
 * Reset the provided audio element and play it from the start. Browsers
 * sometimes reject autoplay attempts, so we swallow those rejections silently
 * to avoid noisy errors in the console while still giving manual playback a
 * chance.
 */
function playBark(audioElement) {
  if (!audioElement) {
    return;
  }

  audioElement.currentTime = 0;
  const playPromise = audioElement.play();
  if (playPromise?.catch) {
    playPromise.catch(() => {
      /* Swallow autoplay prevention errors. */
    });
  }
}

/**
 * Create a document level click/touch handler that plays the bark audio when
 * an interactive element is used. Listening on the document keeps the
 * behaviour consistent even if new buttons are added later.
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

/**
 * Update any UI elements that display the current volume. The slider,
 * descriptive label, and emoji icon stay in sync with the stored value.
 */
function updateVolumeDisplay(volumeSlider, volumeLabel, volumeIcon, volumeValue) {
  if (volumeSlider) {
    volumeSlider.value = String(volumeValue);
  }

  if (volumeLabel) {
    const label = volumeValue <= 33 ? 'Volume: Arf' : volumeValue <= 66 ? 'Volume: Woof' : 'Volume: Bark';
    volumeLabel.textContent = label;
  }

  if (volumeIcon) {
    const icon = volumeValue <= 33 ? '🔈' : volumeValue <= 66 ? '🔉' : '🔊';
    volumeIcon.textContent = icon;
  }
}

/**
 * Initialise the site-wide bark sound controls. The function wires up global
 * click handlers so the dog barks when buttons are pressed, synchronises the
 * test button, and persists the visitor's volume preferences between visits.
 *
 * A cleanup function is returned to make it easy to remove all listeners when
 * the page is unloaded.
 */
export function initAudioControls({
  barkAudio,
  barkTestButton,
  volumeSlider,
  volumeLabel,
  volumeIcon,
}) {
  if (!barkAudio) {
    return () => {};
  }

  const handleInteraction = createInteractionHandler(barkAudio);
  const handleTouchInteraction = createInteractionHandler(barkAudio);

  document.addEventListener('click', handleInteraction);
  document.addEventListener('touchstart', handleTouchInteraction);

  const handleTestButtonClick = () => {
    playBark(barkAudio);
  };

  barkTestButton?.addEventListener('click', handleTestButtonClick);

  const handleVolumeInput = () => {
    const numericValue = Number.parseInt(volumeSlider.value, 10);
    const volumeValue = Number.isFinite(numericValue) ? Math.max(0, Math.min(100, numericValue)) : 100;
    // The underlying HTMLAudioElement expects a value between 0 and 1.
    barkAudio.volume = volumeValue / 100;
    localStorage.setItem(VOLUME_STORAGE_KEY, String(volumeValue));
    updateVolumeDisplay(volumeSlider, volumeLabel, volumeIcon, volumeValue);
  };

  volumeSlider?.addEventListener('input', handleVolumeInput);

  // Restore the visitor's last used volume level if available.
  const savedVolume = Number.parseInt(localStorage.getItem(VOLUME_STORAGE_KEY) ?? '100', 10);
  const initialVolume = Number.isFinite(savedVolume) ? Math.max(0, Math.min(100, savedVolume)) : 100;
  barkAudio.volume = initialVolume / 100;
  updateVolumeDisplay(volumeSlider, volumeLabel, volumeIcon, initialVolume);

  return () => {
    // Remove the global listeners so they do not leak into other pages.
    document.removeEventListener('click', handleInteraction);
    document.removeEventListener('touchstart', handleTouchInteraction);
    barkTestButton?.removeEventListener('click', handleTestButtonClick);
    volumeSlider?.removeEventListener('input', handleVolumeInput);
  };
}
