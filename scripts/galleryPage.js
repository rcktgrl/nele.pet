import { galleryArtworks } from './galleryData.js';

const grid = document.getElementById('gallery-grid');
const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightbox-image');
const lightboxCaption = document.getElementById('lightbox-caption');
const lightboxClose = document.getElementById('lightbox-close');

function openLightbox(artwork) {
  if (!artwork) return;
  lightboxImage.src = artwork.src;
  lightboxImage.alt = artwork.alt;
  lightboxCaption.textContent = artwork.caption;
  lightbox?.classList.add('open');
}

function closeLightbox() {
  lightbox?.classList.remove('open');
  lightboxImage.src = '';
}

function renderGrid() {
  if (!grid) return;

  galleryArtworks.forEach((artwork) => {
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
    tile.addEventListener('click', () => openLightbox(artwork));

    grid.appendChild(tile);
  });
}

renderGrid();
lightboxClose?.addEventListener('click', closeLightbox);
lightbox?.addEventListener('click', (event) => {
  if (event.target === lightbox) {
    closeLightbox();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && lightbox?.classList.contains('open')) {
    closeLightbox();
  }
});
