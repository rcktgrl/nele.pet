import { galleryArtworks } from './galleryData.js';

function clampIndex(index) {
  if (!galleryArtworks.length) {
    return 0;
  }
  const mod = index % galleryArtworks.length;
  return mod < 0 ? mod + galleryArtworks.length : mod;
}

export function initOcsGallerySlider() {
  const slider = document.querySelector('[data-gallery-slider]');
  const imageEl = slider?.querySelector('[data-gallery-image]');
  const captionEl = slider?.querySelector('[data-gallery-caption]');
  const prevButton = slider?.querySelector('[data-gallery-prev]');
  const nextButton = slider?.querySelector('[data-gallery-next]');

  if (!slider || !imageEl || !captionEl || galleryArtworks.length === 0) {
    return () => {};
  }

  let currentIndex = 0;

  const render = () => {
    const artwork = galleryArtworks[clampIndex(currentIndex)];
    imageEl.src = artwork.src;
    imageEl.alt = artwork.alt;
    captionEl.textContent = artwork.caption;
  };

  const showPrevious = () => {
    currentIndex = clampIndex(currentIndex - 1);
    render();
  };

  const showNext = () => {
    currentIndex = clampIndex(currentIndex + 1);
    render();
  };

  prevButton?.addEventListener('click', showPrevious);
  nextButton?.addEventListener('click', showNext);

  render();

  return () => {
    prevButton?.removeEventListener('click', showPrevious);
    nextButton?.removeEventListener('click', showNext);
  };
}
