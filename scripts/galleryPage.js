import { galleryArtworks } from './galleryData.js';

const grid = document.getElementById('gallery-grid');
const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightbox-image');
const lightboxCaption = document.getElementById('lightbox-caption');
const lightboxClose = document.getElementById('lightbox-close');
const previousButton = document.getElementById('lightbox-prev');
const nextButton = document.getElementById('lightbox-next');
const backgroundCanvas = document.querySelector('.background-canvas');

const defaultBackground = backgroundCanvas
  ? getComputedStyle(backgroundCanvas).backgroundImage
  : '';

let currentIndex = -1;

function setBackgroundForArtwork(artwork) {
  if (!backgroundCanvas) return;

  if (artwork) {
    backgroundCanvas.style.backgroundImage = `linear-gradient(120deg, rgba(14, 2, 28, 0.72), rgba(18, 6, 42, 0.62)), url(${artwork.src})`;
    backgroundCanvas.style.backgroundSize = 'cover';
    backgroundCanvas.style.backgroundPosition = 'center';
    backgroundCanvas.style.backgroundRepeat = 'no-repeat';
  } else {
    backgroundCanvas.style.backgroundImage = defaultBackground;
    backgroundCanvas.style.backgroundSize = '';
    backgroundCanvas.style.backgroundPosition = '';
    backgroundCanvas.style.backgroundRepeat = '';
  }
}

function openLightbox(artwork, index) {
  if (!artwork) return;
  currentIndex = index;
  lightboxImage.src = artwork.src;
  lightboxImage.alt = artwork.alt;
  lightboxCaption.textContent = artwork.caption;
  lightbox?.classList.add('open');
  setBackgroundForArtwork(artwork);
}

function closeLightbox() {
  lightbox?.classList.remove('open');
  lightboxImage.src = '';
  setBackgroundForArtwork(null);
  currentIndex = -1;
}

function renderGrid() {
  if (!grid) return;

  galleryArtworks.forEach((artwork, index) => {
    const tile = document.createElement('button');
    tile.className = 'gallery-grid__item';
    tile.type = 'button';
    tile.setAttribute('aria-label', `Open ${artwork.caption}`);

    const thumb = document.createElement('img');
    thumb.src = artwork.src;
    thumb.alt = artwork.alt;
    thumb.loading = 'lazy';

    const label = document.createElement('span');
    label.className = 'gallery-grid__label';
    label.textContent = artwork.caption;

    tile.appendChild(thumb);
    tile.appendChild(label);
    tile.addEventListener('click', () => openLightbox(artwork, index));

    grid.appendChild(tile);
  });
}

renderGrid();
lightboxClose?.addEventListener('click', closeLightbox);
previousButton?.addEventListener('click', () => navigateLightbox(-1));
nextButton?.addEventListener('click', () => navigateLightbox(1));
lightbox?.addEventListener('click', (event) => {
  if (event.target === lightbox) {
    closeLightbox();
  }
});

function navigateLightbox(step) {
  if (currentIndex < 0) return;

  const nextIndex = (currentIndex + step + galleryArtworks.length) % galleryArtworks.length;
  const artwork = galleryArtworks[nextIndex];
  openLightbox(artwork, nextIndex);
}

document.addEventListener('keydown', (event) => {
  if (!lightbox?.classList.contains('open')) return;

  if (event.key === 'Escape') {
    closeLightbox();
  }

  if (event.key === 'ArrowRight') {
    navigateLightbox(1);
  }

  if (event.key === 'ArrowLeft') {
    navigateLightbox(-1);
  }
});
