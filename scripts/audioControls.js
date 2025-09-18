const INTERACTION_TARGET_SELECTOR = 'button, .link-button, span';
const VOLUME_STORAGE_KEY = 'barkVolume';

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

function createInteractionHandler(audioElement) {
  return (event) => {
    const target = event.target?.closest?.(INTERACTION_TARGET_SELECTOR);
    if (!target) {
      return;
    }

    playBark(audioElement);
  };
}

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
    barkAudio.volume = volumeValue / 100;
    localStorage.setItem(VOLUME_STORAGE_KEY, String(volumeValue));
    updateVolumeDisplay(volumeSlider, volumeLabel, volumeIcon, volumeValue);
  };

  volumeSlider?.addEventListener('input', handleVolumeInput);

  const savedVolume = Number.parseInt(localStorage.getItem(VOLUME_STORAGE_KEY) ?? '100', 10);
  const initialVolume = Number.isFinite(savedVolume) ? Math.max(0, Math.min(100, savedVolume)) : 100;
  barkAudio.volume = initialVolume / 100;
  updateVolumeDisplay(volumeSlider, volumeLabel, volumeIcon, initialVolume);

  return () => {
    document.removeEventListener('click', handleInteraction);
    document.removeEventListener('touchstart', handleTouchInteraction);
    barkTestButton?.removeEventListener('click', handleTestButtonClick);
    volumeSlider?.removeEventListener('input', handleVolumeInput);
  };
}
