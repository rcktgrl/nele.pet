/**
 * The hero slider is responsible for swapping the large background artwork on
 * the landing page. These constants define how often the image should rotate
 * and the maximum canvas size for different viewport scenarios.
 */
const HERO_ROTATION_INTERVAL = 20000;
const HERO_DESKTOP_MAX_WIDTH = 1500;
const HERO_DESKTOP_MAX_HEIGHT = 1125;
const HERO_MOBILE_MAX_DIMENSION = 640;
const HERO_DESKTOP_WIDTH_RATIO = 0.98;
const HERO_DESKTOP_HEIGHT_RATIO = 0.95;
const HERO_MOBILE_WIDTH_RATIO = 0.96;
const HERO_MOBILE_HEIGHT_RATIO = 0.85;

/**
 * Encapsulates all behaviour for the rotating hero artwork, including sizing,
 * automatic rotation, manual navigation, and respecting reduced motion
 * preferences.
 */
class HeroSlider {
  constructor({ sliderElement, nextButton, images }) {
    this.sliderElement = sliderElement;
    this.nextButton = nextButton;
    this.images = Array.isArray(images) ? images : [];

    this.reduceMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    this.smallScreenQuery = window.matchMedia?.('(max-width: 600px)') ?? null;

    // Track viewer preferences and the current state of the slider.
    this.prefersReducedMotion = this.reduceMotionQuery?.matches ?? false;
    this.currentIndex = this.images.length ? Math.floor(Math.random() * this.images.length) : 0;
    this.activeImage = null;
    this.isAnimating = false;
    this.rotationTimer = null;
    this.pendingAdvanceCount = 0;

    // Bind instance methods once so they can be safely added/removed as listeners.
    this.handleResize = this.updateSliderSize.bind(this);
    this.handleSmallScreenChange = this.updateSliderSize.bind(this);
    this.handleNextButtonClick = this.handleNextButtonClick.bind(this);
    this.handleRotationTick = this.handleRotationTick.bind(this);
    this.handleReduceMotionChange = this.handleReduceMotionChange.bind(this);
  }

  /** Attach DOM listeners and render the initial hero image. */
  init() {
    if (!this.sliderElement) {
      this.nextButton?.setAttribute('disabled', 'true');
      return;
    }

    if (!this.images.length) {
      this.nextButton?.setAttribute('disabled', 'true');
      return;
    }

    this.showImage(this.currentIndex, { animate: false });
    this.updateSliderSize();

    window.addEventListener('resize', this.handleResize);

    if (this.smallScreenQuery) {
      if (typeof this.smallScreenQuery.addEventListener === 'function') {
        this.smallScreenQuery.addEventListener('change', this.handleSmallScreenChange);
      } else if (typeof this.smallScreenQuery.addListener === 'function') {
        this.smallScreenQuery.addListener(this.handleSmallScreenChange);
      }
    }

    if (this.reduceMotionQuery) {
      if (typeof this.reduceMotionQuery.addEventListener === 'function') {
        this.reduceMotionQuery.addEventListener('change', this.handleReduceMotionChange);
      } else if (typeof this.reduceMotionQuery.addListener === 'function') {
        this.reduceMotionQuery.addListener(this.handleReduceMotionChange);
      }
    }

    this.nextButton?.addEventListener('click', this.handleNextButtonClick);
    this.startRotation();
  }

  /** Tear down any timers and event listeners created during init(). */
  destroy() {
    window.removeEventListener('resize', this.handleResize);

    if (this.smallScreenQuery) {
      if (typeof this.smallScreenQuery.removeEventListener === 'function') {
        this.smallScreenQuery.removeEventListener('change', this.handleSmallScreenChange);
      } else if (typeof this.smallScreenQuery.removeListener === 'function') {
        this.smallScreenQuery.removeListener(this.handleSmallScreenChange);
      }
    }

    if (this.reduceMotionQuery) {
      if (typeof this.reduceMotionQuery.removeEventListener === 'function') {
        this.reduceMotionQuery.removeEventListener('change', this.handleReduceMotionChange);
      } else if (typeof this.reduceMotionQuery.removeListener === 'function') {
        this.reduceMotionQuery.removeListener(this.handleReduceMotionChange);
      }
    }

    this.nextButton?.removeEventListener('click', this.handleNextButtonClick);
    this.stopRotation();
  }

  /** Called by the rotation timer to advance to the next image. */
  handleRotationTick() {
    if (this.prefersReducedMotion || this.images.length <= 1) {
      return;
    }

    const nextIndex = (this.currentIndex + 1) % this.images.length;
    this.showImage(nextIndex, { animate: true });
  }

  /** Start the automatic slideshow unless motion should be reduced. */
  startRotation() {
    if (this.prefersReducedMotion || this.images.length <= 1) {
      this.stopRotation();
      return;
    }

    this.stopRotation();
    this.rotationTimer = window.setInterval(this.handleRotationTick, HERO_ROTATION_INTERVAL);
  }

  /** Clear the rotation timer if one is running. */
  stopRotation() {
    if (this.rotationTimer !== null) {
      window.clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }
  }

  /** Advance to the next hero image when the "next" button is pressed. */
  handleNextButtonClick() {
    if (this.images.length <= 1) {
      return;
    }

    this.stopRotation();
    const nextIndex = (this.currentIndex + 1) % this.images.length;
    this.showImage(nextIndex, { animate: true });
    this.startRotation();
  }

  /** Respect changes to the user's reduced motion preference immediately. */
  handleReduceMotionChange(event) {
    this.prefersReducedMotion = event.matches;
    if (this.prefersReducedMotion) {
      this.stopRotation();
    } else {
      this.startRotation();
    }
  }

  /**
   * Resize the slider container so it closely matches the current image while
   * staying within the allowed bounds for the viewport size.
   */
  updateSliderSize(image = this.activeImage) {
    if (!this.sliderElement) {
      return;
    }

    const { maxWidth, maxHeight } = this.getSliderBounds();

    let width = maxWidth;
    let height = maxHeight;

    if (image?.naturalWidth > 0 && image?.naturalHeight > 0) {
      const aspectRatio = image.naturalWidth / image.naturalHeight;
      width = maxWidth;
      height = width / aspectRatio;

      if (height > maxHeight) {
        height = maxHeight;
        width = height * aspectRatio;
      }
    }

    this.sliderElement.style.width = `${width}px`;
    this.sliderElement.style.height = `${height}px`;

    const rootStyle = document.documentElement?.style;
    if (rootStyle) {
      rootStyle.setProperty('--hero-canvas-width', `${width}px`);
      rootStyle.setProperty('--hero-canvas-height', `${height}px`);
      if (height > 0) {
        rootStyle.setProperty('--hero-canvas-aspect', (width / height).toString());
      }
    }
  }

  /** Calculate the maximum allowed width and height for the hero slider. */
  getSliderBounds() {
    const isSmallScreen = this.smallScreenQuery?.matches ?? false;
    const maxWidth = Math.min(
      isSmallScreen ? HERO_MOBILE_MAX_DIMENSION : HERO_DESKTOP_MAX_WIDTH,
      window.innerWidth * (isSmallScreen ? HERO_MOBILE_WIDTH_RATIO : HERO_DESKTOP_WIDTH_RATIO),
    );

    const maxHeight = Math.min(
      isSmallScreen ? HERO_MOBILE_MAX_DIMENSION : HERO_DESKTOP_MAX_HEIGHT,
      window.innerHeight * (isSmallScreen ? HERO_MOBILE_HEIGHT_RATIO : HERO_DESKTOP_HEIGHT_RATIO),
    );

    return {
      maxWidth: Math.max(1, maxWidth),
      maxHeight: Math.max(1, maxHeight),
    };
  }

  /**
   * Build a DOM element for the given image data and ensure that the slider is
   * resized once the image dimensions are known.
   */
  createImageElement(image, additionalClass = '') {
    const element = document.createElement('img');
    element.className = `hero-layer__image ${additionalClass}`.trim();
    element.src = image.src;
    element.alt = image.alt;
    this.ensureImageResizesSlider(element);
    return element;
  }

  /**
   * Ensure the slider resizes when the provided image loads or fails to load.
   * This keeps the layout stable as images change.
   */
  ensureImageResizesSlider(image) {
    if (!image) {
      return;
    }

    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      this.updateSliderSize(image);
      return;
    }

    const handleLoad = () => {
      this.updateSliderSize(image);
    };

    const handleError = () => {
      this.updateSliderSize();
    };

    image.addEventListener('load', handleLoad, { once: true });
    image.addEventListener('error', handleError, { once: true });
  }

  /** Wrap any index so that it always falls within the available image range. */
  normaliseIndex(index) {
    if (!this.images.length) {
      return 0;
    }

    const mod = index % this.images.length;
    return mod < 0 ? mod + this.images.length : mod;
  }

  /**
   * Display the image at the provided index. When animation is enabled the
   * method orchestrates a small slide transition and queues any additional
   * navigation requests so they play one after another.
   */
  showImage(index, { animate = true } = {}) {
    if (!this.sliderElement || !this.images.length) {
      this.pendingAdvanceCount = 0;
      this.nextButton?.setAttribute('disabled', 'true');
      return;
    }

    const targetIndex = this.normaliseIndex(index);
    const shouldAnimate = animate && !this.prefersReducedMotion && !!this.activeImage;

    if (this.isAnimating && shouldAnimate) {
      // Queue the request so it runs after the current animation completes.
      this.pendingAdvanceCount += 1;
      return;
    }

    const imageData = this.images[targetIndex];
    const newImage = this.createImageElement(
      imageData,
      shouldAnimate ? 'hero-layer__image--incoming' : 'hero-layer__image--current',
    );

    if (!shouldAnimate) {
      this.sliderElement.appendChild(newImage);
      if (this.activeImage && this.activeImage.parentElement === this.sliderElement) {
        this.sliderElement.removeChild(this.activeImage);
      }
      this.activeImage = newImage;
      this.currentIndex = targetIndex;
      this.pendingAdvanceCount = 0;
      this.nextButton?.removeAttribute('disabled');
      return;
    }

    this.isAnimating = true;
    this.sliderElement.appendChild(newImage);

    const startTransition = () => {
      window.requestAnimationFrame(() => {
        newImage.classList.add('hero-layer__image--slide-in');
        this.activeImage?.classList.add('hero-layer__image--slide-out');
      });
    };

    if (typeof newImage.decode === 'function') {
      newImage
        .decode()
        .catch(() => {})
        .finally(startTransition);
    } else if (!newImage.complete) {
      newImage.addEventListener('load', startTransition, { once: true });
      newImage.addEventListener('error', startTransition, { once: true });
    } else {
      startTransition();
    }

    let hasFinalised = false;
    // Fallback timeout so we do not get stuck if the transitionend event
    // never fires (for example if styles change).
    let transitionTimeout = window.setTimeout(() => {
      finaliseTransition();
    }, 900);

    const handleTransitionEnd = (event) => {
      if (event.propertyName === 'transform') {
        finaliseTransition();
      }
    };

    const handleTransitionCancel = () => {
      finaliseTransition();
    };

    const cleanup = () => {
      newImage.removeEventListener('transitionend', handleTransitionEnd);
      newImage.removeEventListener('transitioncancel', handleTransitionCancel);
      if (transitionTimeout !== null) {
        window.clearTimeout(transitionTimeout);
        transitionTimeout = null;
      }
    };

    const finaliseTransition = () => {
      if (hasFinalised) {
        return;
      }

      hasFinalised = true;
      cleanup();
      newImage.classList.remove('hero-layer__image--incoming', 'hero-layer__image--slide-in');
      newImage.classList.add('hero-layer__image--current');

      if (this.activeImage && this.activeImage.parentElement === this.sliderElement) {
        this.sliderElement.removeChild(this.activeImage);
      }

      this.activeImage = newImage;
      this.currentIndex = targetIndex;
      this.isAnimating = false;
      this.nextButton?.removeAttribute('disabled');

      if (this.pendingAdvanceCount > 0) {
        if (this.images.length > 1) {
          this.pendingAdvanceCount -= 1;
          const nextIndex = (this.currentIndex + 1) % this.images.length;
          this.showImage(nextIndex, { animate: true });
        } else {
          this.pendingAdvanceCount = 0;
        }
      }
    };

    newImage.addEventListener('transitionend', handleTransitionEnd);
    newImage.addEventListener('transitioncancel', handleTransitionCancel);
  }
}

/**
 * Convenience helper used by index.js to create and initialise a slider while
 * returning a cleanup callback for teardown.
 */
export function initHeroSlider(options) {
  const slider = new HeroSlider(options);
  slider.init();
  return () => slider.destroy();
}
