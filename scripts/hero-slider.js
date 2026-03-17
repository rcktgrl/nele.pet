/**
 * hero-slider.js
 *
 * Displays a rotating hero artwork on the landing page. Images cycle
 * automatically every 20 seconds, with smooth CSS slide transitions.
 *
 * Key behaviours:
 * - Auto-rotation pauses when the visitor prefers reduced motion.
 * - A manual "next" button lets visitors advance at their own pace.
 * - If a navigation request arrives while an animation is playing, it is
 *   queued and processed as soon as the current transition finishes.
 * - The slider container resizes to match each image's aspect ratio,
 *   capped at sensible maximums for desktop and mobile viewports.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long (in ms) each image is shown before automatically advancing. */
const HERO_ROTATION_INTERVAL = 20000;

/** Maximum pixel dimensions for the slider on a desktop viewport. */
const HERO_DESKTOP_MAX_WIDTH  = 1500;
const HERO_DESKTOP_MAX_HEIGHT = 1125;

/** Maximum pixel dimension for either axis on a small/mobile viewport. */
const HERO_MOBILE_MAX_DIMENSION = 640;

/**
 * Fraction of the viewport used when calculating the slider's maximum size.
 * Keeping these below 1.0 leaves a small breathing gap around the edges.
 */
const HERO_DESKTOP_WIDTH_RATIO  = 0.98;
const HERO_DESKTOP_HEIGHT_RATIO = 0.95;
const HERO_MOBILE_WIDTH_RATIO   = 0.96;
const HERO_MOBILE_HEIGHT_RATIO  = 0.85;

// ---------------------------------------------------------------------------
// HeroSlider class
// ---------------------------------------------------------------------------

/**
 * Encapsulates all behaviour for the rotating hero artwork section:
 * sizing, automatic rotation, manual navigation, and reduced-motion support.
 */
class HeroSlider {
  /**
   * @param {object}      options
   * @param {HTMLElement} options.sliderElement - The container element for the hero images.
   * @param {HTMLElement} options.nextButton    - Button that advances to the next image (optional).
   * @param {Array}       options.images        - Array of artwork objects from gallery-data.js.
   */
  constructor({ sliderElement, nextButton, images }) {
    this.sliderElement = sliderElement;
    this.nextButton    = nextButton;
    this.images        = Array.isArray(images) ? images : [];

    // Media queries so we can respond to viewport and motion preference changes.
    this.reduceMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    this.smallScreenQuery  = window.matchMedia?.('(max-width: 600px)') ?? null;

    // Current state of the slider.
    this.prefersReducedMotion = this.reduceMotionQuery?.matches ?? false;
    this.currentIndex         = this.images.length
      ? Math.floor(Math.random() * this.images.length)  // start on a random image
      : 0;
    this.activeImage          = null;   // The DOM element currently visible.
    this.isAnimating          = false;  // True while a slide transition is in progress.
    this.rotationTimer        = null;   // ID returned by setInterval.
    this.pendingAdvanceCount  = 0;      // How many advances are queued behind the current animation.

    // Bind instance methods once so the same reference can be added and removed.
    this.handleResize             = this.updateSliderSize.bind(this);
    this.handleSmallScreenChange  = this.updateSliderSize.bind(this);
    this.handleNextButtonClick    = this.handleNextButtonClick.bind(this);
    this.handleRotationTick       = this.handleRotationTick.bind(this);
    this.handleReduceMotionChange = this.handleReduceMotionChange.bind(this);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Attach all DOM listeners and display the initial hero image.
   * Call this once after constructing the slider.
   */
  init() {
    // Disable the next button and bail out early if there is nothing to show.
    if (!this.sliderElement || !this.images.length) {
      this.nextButton?.setAttribute('disabled', 'true');
      return;
    }

    // Show the starting image without any animation.
    this.showImage(this.currentIndex, { animate: false });
    this.updateSliderSize();

    // Respond to window resizes so the slider stays the right size.
    window.addEventListener('resize', this.handleResize);

    // Re-size when the viewport crosses the mobile/desktop breakpoint.
    this.addMediaQueryListener(this.smallScreenQuery,  this.handleSmallScreenChange);

    // Start or stop rotation when the visitor changes their motion preference.
    this.addMediaQueryListener(this.reduceMotionQuery, this.handleReduceMotionChange);

    this.nextButton?.addEventListener('click', this.handleNextButtonClick);
    this.startRotation();
  }

  /**
   * Remove all timers and event listeners created during init().
   * Call this when the page is about to be torn down.
   */
  destroy() {
    window.removeEventListener('resize', this.handleResize);

    this.removeMediaQueryListener(this.smallScreenQuery,  this.handleSmallScreenChange);
    this.removeMediaQueryListener(this.reduceMotionQuery, this.handleReduceMotionChange);

    this.nextButton?.removeEventListener('click', this.handleNextButtonClick);
    this.stopRotation();
  }

  // ---------------------------------------------------------------------------
  // MediaQuery helpers
  // ---------------------------------------------------------------------------

  /**
   * Add a change listener to a MediaQueryList, supporting both the modern
   * addEventListener API and the legacy addListener fallback.
   *
   * @param {MediaQueryList|null} query
   * @param {Function}            handler
   */
  addMediaQueryListener(query, handler) {
    if (!query) {
      return;
    }

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', handler);
    } else if (typeof query.addListener === 'function') {
      query.addListener(handler);
    }
  }

  /**
   * Remove a change listener from a MediaQueryList, mirroring addMediaQueryListener.
   *
   * @param {MediaQueryList|null} query
   * @param {Function}            handler
   */
  removeMediaQueryListener(query, handler) {
    if (!query) {
      return;
    }

    if (typeof query.removeEventListener === 'function') {
      query.removeEventListener('change', handler);
    } else if (typeof query.removeListener === 'function') {
      query.removeListener(handler);
    }
  }

  // ---------------------------------------------------------------------------
  // Rotation timer
  // ---------------------------------------------------------------------------

  /**
   * Called on every rotation tick to advance to the next image automatically.
   * Does nothing if the visitor prefers reduced motion or if there is only
   * one image to show.
   */
  handleRotationTick() {
    if (this.prefersReducedMotion || this.images.length <= 1) {
      return;
    }

    const nextIndex = (this.currentIndex + 1) % this.images.length;
    this.showImage(nextIndex, { animate: true });
  }

  /**
   * Start the automatic rotation timer.
   * If reduced motion is preferred, or there is only one image, the timer is
   * stopped instead of started.
   */
  startRotation() {
    if (this.prefersReducedMotion || this.images.length <= 1) {
      this.stopRotation();
      return;
    }

    // Clear any existing timer first so we never run two at once.
    this.stopRotation();
    this.rotationTimer = window.setInterval(this.handleRotationTick, HERO_ROTATION_INTERVAL);
  }

  /** Cancel the rotation timer if one is running. */
  stopRotation() {
    if (this.rotationTimer !== null) {
      window.clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  /**
   * Handle the manual "next" button.
   * Resets the rotation timer so the automatic advance is counted from now,
   * not from whenever the timer happened to fire next.
   */
  handleNextButtonClick() {
    if (this.images.length <= 1) {
      return;
    }

    this.stopRotation();
    const nextIndex = (this.currentIndex + 1) % this.images.length;
    this.showImage(nextIndex, { animate: true });
    this.startRotation();
  }

  /**
   * Respond to changes in the visitor's reduced-motion preference.
   * Immediately stops or starts the rotation to match the new setting.
   *
   * @param {MediaQueryListEvent} event
   */
  handleReduceMotionChange(event) {
    this.prefersReducedMotion = event.matches;

    if (this.prefersReducedMotion) {
      this.stopRotation();
    } else {
      this.startRotation();
    }
  }

  // ---------------------------------------------------------------------------
  // Sizing
  // ---------------------------------------------------------------------------

  /**
   * Resize the slider container to closely match the current image's aspect
   * ratio while staying within the allowed bounds for the current viewport.
   *
   * Also exposes the final dimensions as CSS custom properties so any other
   * CSS rules that need the hero size can reference them.
   *
   * @param {HTMLImageElement} [image=this.activeImage] - Source of natural dimensions.
   */
  updateSliderSize(image = this.activeImage) {
    if (!this.sliderElement) {
      return;
    }

    const { maxWidth, maxHeight } = this.getSliderBounds();

    let width  = maxWidth;
    let height = maxHeight;

    if (image?.naturalWidth > 0 && image?.naturalHeight > 0) {
      const aspectRatio = image.naturalWidth / image.naturalHeight;

      // Fit within the max width first, then check if height overshoots.
      width  = maxWidth;
      height = width / aspectRatio;

      if (height > maxHeight) {
        // Height would overflow — constrain by height and recalculate width.
        height = maxHeight;
        width  = height * aspectRatio;
      }
    }

    this.sliderElement.style.width  = `${width}px`;
    this.sliderElement.style.height = `${height}px`;

    // Publish as CSS variables so stylesheets can use the current hero size.
    const rootStyle = document.documentElement?.style;
    if (rootStyle) {
      rootStyle.setProperty('--hero-canvas-width',  `${width}px`);
      rootStyle.setProperty('--hero-canvas-height', `${height}px`);

      if (height > 0) {
        rootStyle.setProperty('--hero-canvas-aspect', (width / height).toString());
      }
    }
  }

  /**
   * Calculate the maximum allowed width and height for the slider based on
   * the current viewport size and whether we are on a small screen.
   *
   * @returns {{ maxWidth: number, maxHeight: number }}
   */
  getSliderBounds() {
    const isSmallScreen = this.smallScreenQuery?.matches ?? false;

    const absoluteMaxWidth  = isSmallScreen ? HERO_MOBILE_MAX_DIMENSION : HERO_DESKTOP_MAX_WIDTH;
    const absoluteMaxHeight = isSmallScreen ? HERO_MOBILE_MAX_DIMENSION : HERO_DESKTOP_MAX_HEIGHT;
    const widthRatio        = isSmallScreen ? HERO_MOBILE_WIDTH_RATIO   : HERO_DESKTOP_WIDTH_RATIO;
    const heightRatio       = isSmallScreen ? HERO_MOBILE_HEIGHT_RATIO  : HERO_DESKTOP_HEIGHT_RATIO;

    const maxWidth  = Math.min(absoluteMaxWidth,  window.innerWidth  * widthRatio);
    const maxHeight = Math.min(absoluteMaxHeight, window.innerHeight * heightRatio);

    // Clamp to at least 1px so we never set a zero or negative dimension.
    return {
      maxWidth:  Math.max(1, maxWidth),
      maxHeight: Math.max(1, maxHeight),
    };
  }

  // ---------------------------------------------------------------------------
  // Image element creation
  // ---------------------------------------------------------------------------

  /**
   * Create a new <img> element for the given artwork and ensure the slider
   * resizes itself once the image's natural dimensions are known.
   *
   * @param {object} image            - An artwork object from gallery-data.js.
   * @param {string} [additionalClass=''] - Extra CSS class to apply to the element.
   * @returns {HTMLImageElement}
   */
  createImageElement(image, additionalClass = '') {
    const element     = document.createElement('img');
    element.className = `hero-layer__image ${additionalClass}`.trim();
    element.src       = image.src;
    element.alt       = image.alt;

    this.ensureImageResizesSlider(element);
    return element;
  }

  /**
   * Attach load/error listeners to the image so the slider resizes as soon as
   * the browser knows the image's natural dimensions.
   *
   * If the image is already in the cache (complete === true), resize immediately.
   *
   * @param {HTMLImageElement} image
   */
  ensureImageResizesSlider(image) {
    if (!image) {
      return;
    }

    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      // Image was served from cache — dimensions are already available.
      this.updateSliderSize(image);
      return;
    }

    const handleLoad  = () => this.updateSliderSize(image);
    const handleError = () => this.updateSliderSize();

    // { once: true } automatically removes each listener after it fires once.
    image.addEventListener('load',  handleLoad,  { once: true });
    image.addEventListener('error', handleError, { once: true });
  }

  // ---------------------------------------------------------------------------
  // Index helpers
  // ---------------------------------------------------------------------------

  /**
   * Wrap an arbitrary index so it always falls within [0, images.length).
   * Handles negative values so backward navigation wraps correctly.
   *
   * @param {number} index
   * @returns {number}
   */
  normaliseIndex(index) {
    if (!this.images.length) {
      return 0;
    }

    const mod = index % this.images.length;
    return mod < 0 ? mod + this.images.length : mod;
  }

  // ---------------------------------------------------------------------------
  // Image display
  // ---------------------------------------------------------------------------

  /**
   * Display the image at the given index.
   *
   * When animation is disabled (or the visitor prefers reduced motion), the
   * swap is instantaneous. With animation, a CSS slide-in/slide-out transition
   * plays; any navigation requests that arrive mid-transition are queued so
   * they run one after another once the transition finishes.
   *
   * @param {number}  index
   * @param {object}  [options]
   * @param {boolean} [options.animate=true] - Whether to play the transition.
   */
  showImage(index, { animate = true } = {}) {
    if (!this.sliderElement || !this.images.length) {
      this.pendingAdvanceCount = 0;
      this.nextButton?.setAttribute('disabled', 'true');
      return;
    }

    const targetIndex   = this.normaliseIndex(index);
    const shouldAnimate = animate && !this.prefersReducedMotion && !!this.activeImage;

    // If a transition is already playing, queue this advance for later.
    if (this.isAnimating && shouldAnimate) {
      this.pendingAdvanceCount += 1;
      return;
    }

    const imageData = this.images[targetIndex];
    const newImage  = this.createImageElement(
      imageData,
      shouldAnimate ? 'hero-layer__image--incoming' : 'hero-layer__image--current',
    );

    // ---------------------------------------------------------------------------
    // Instant swap (no animation)
    // ---------------------------------------------------------------------------

    if (!shouldAnimate) {
      this.sliderElement.appendChild(newImage);

      // Remove the old image from the DOM if it is still attached.
      if (this.activeImage && this.activeImage.parentElement === this.sliderElement) {
        this.sliderElement.removeChild(this.activeImage);
      }

      this.activeImage         = newImage;
      this.currentIndex        = targetIndex;
      this.pendingAdvanceCount = 0;
      this.nextButton?.removeAttribute('disabled');
      return;
    }

    // ---------------------------------------------------------------------------
    // Animated slide transition
    // ---------------------------------------------------------------------------

    this.isAnimating = true;
    this.sliderElement.appendChild(newImage);

    /**
     * Kick off the CSS transition on the next animation frame.
     * Adding the slide classes one frame after the element is in the DOM
     * ensures the browser has had a chance to compute the initial (off-screen)
     * position before the transition starts.
     */
    function startTransition() {
      window.requestAnimationFrame(() => {
        newImage.classList.add('hero-layer__image--slide-in');
        this.activeImage?.classList.add('hero-layer__image--slide-out');
      });
    }

    // Wait for the image to decode before starting the animation so there is
    // no flash of a broken or placeholder image mid-transition.
    if (typeof newImage.decode === 'function') {
      newImage
        .decode()
        .catch(() => { /* Ignore decode errors — startTransition still runs. */ })
        .finally(startTransition.bind(this));
    } else if (!newImage.complete) {
      newImage.addEventListener('load',  startTransition.bind(this), { once: true });
      newImage.addEventListener('error', startTransition.bind(this), { once: true });
    } else {
      startTransition.call(this);
    }

    // ---------------------------------------------------------------------------
    // Transition finalisation
    // ---------------------------------------------------------------------------

    let hasFinalised = false;

    /**
     * Tidy up after the transition completes: swap the active image reference,
     * reset the animating flag, and process any queued advances.
     */
    const finaliseTransition = () => {
      // Guard against being called twice (both the event and the fallback timeout).
      if (hasFinalised) {
        return;
      }

      hasFinalised = true;
      cleanup();

      // Promote the new image to the "current" state and remove staging classes.
      newImage.classList.remove('hero-layer__image--incoming', 'hero-layer__image--slide-in');
      newImage.classList.add('hero-layer__image--current');

      // Remove the old image from the DOM now that the new one is fully visible.
      if (this.activeImage && this.activeImage.parentElement === this.sliderElement) {
        this.sliderElement.removeChild(this.activeImage);
      }

      this.activeImage  = newImage;
      this.currentIndex = targetIndex;
      this.isAnimating  = false;
      this.nextButton?.removeAttribute('disabled');

      // Process the next queued advance, if any.
      if (this.pendingAdvanceCount > 0 && this.images.length > 1) {
        this.pendingAdvanceCount -= 1;
        const nextIndex = (this.currentIndex + 1) % this.images.length;
        this.showImage(nextIndex, { animate: true });
      } else {
        this.pendingAdvanceCount = 0;
      }
    };

    // Fallback timeout ensures we never get permanently stuck if the
    // transitionend event fails to fire (e.g. if CSS is stripped away).
    let transitionTimeout = window.setTimeout(finaliseTransition, 900);

    const handleTransitionEnd = (event) => {
      // Only respond to the transform transition, not other animated properties.
      if (event.propertyName === 'transform') {
        finaliseTransition();
      }
    };

    const handleTransitionCancel = () => {
      finaliseTransition();
    };

    /** Remove transition listeners and cancel the fallback timeout. */
    const cleanup = () => {
      newImage.removeEventListener('transitionend',    handleTransitionEnd);
      newImage.removeEventListener('transitioncancel', handleTransitionCancel);

      if (transitionTimeout !== null) {
        window.clearTimeout(transitionTimeout);
        transitionTimeout = null;
      }
    };

    newImage.addEventListener('transitionend',    handleTransitionEnd);
    newImage.addEventListener('transitioncancel', handleTransitionCancel);
  }
}

// ---------------------------------------------------------------------------
// Factory export
// ---------------------------------------------------------------------------

/**
 * Create and initialise a HeroSlider, then return a teardown callback.
 * This is the only export from this module; index.js calls it directly.
 *
 * @param {object} options - Forwarded to the HeroSlider constructor.
 * @returns {() => void} A cleanup function that destroys the slider on call.
 */
export function initHeroSlider(options) {
  const slider = new HeroSlider(options);
  slider.init();
  return () => slider.destroy();
}
