/**
 * cookie-consent.js
 *
 * Manages the cookie consent popup shown to first-time visitors.
 *
 * On load, the script checks whether the visitor has already accepted cookies.
 * If they have, the page is immediately unlocked. If not, the popup blurs the
 * background and waits for a choice.
 *
 * Visitors can also open an info modal to see exactly which cookies are used,
 * and a small bear button lets them reset their choice if they change their mind.
 */

/** Name of the cookie used to store the visitor's consent decision. */
const COOKIE_NAME = 'cookieConsent';

/** The value written to the cookie when the visitor accepts. */
const COOKIE_ACCEPTED_VALUE = 'accepted';

/**
 * Cookie names that are cleared when the visitor clicks the bear button to
 * reset their consent. Add more names here if additional consent cookies are
 * introduced in the future.
 */
const COOKIE_NAMES_TO_CLEAR = ['cookieConsent'];

// ---------------------------------------------------------------------------
// Low-level cookie utilities
// ---------------------------------------------------------------------------

/**
 * Read a single cookie value by name.
 * Returns undefined if the cookie does not exist.
 *
 * @param {string} name - The cookie name to look up.
 * @returns {string|undefined}
 */
function getCookie(name) {
  const match = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith(`${name}=`));

  return match?.split('=')[1];
}

/**
 * Write a cookie that expires after the given number of days.
 *
 * @param {string} name      - Cookie name.
 * @param {string} value     - Cookie value.
 * @param {number} daysValid - How many days until the cookie expires.
 */
function setCookie(name, value, daysValid) {
  const expiryDate = new Date();
  expiryDate.setTime(expiryDate.getTime() + daysValid * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Lax`;
}

/**
 * Delete a cookie immediately by setting its expiry date to the past.
 *
 * @param {string} name - The cookie name to remove.
 */
function deleteCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
}

// ---------------------------------------------------------------------------
// Popup visibility helpers
// ---------------------------------------------------------------------------

/**
 * Hide the consent popup from both the visual layout and screen readers.
 *
 * @param {HTMLElement} popup
 */
function hidePopup(popup) {
  popup?.classList.add('hidden');
  popup?.setAttribute('aria-hidden', 'true');
}

/**
 * Show the consent popup and make it accessible to screen readers.
 *
 * @param {HTMLElement} popup
 */
function showPopup(popup) {
  popup?.classList.remove('hidden');
  popup?.setAttribute('aria-hidden', 'false');
}

// ---------------------------------------------------------------------------
// Main initialisation
// ---------------------------------------------------------------------------

/**
 * Set up the cookie consent system and return a cleanup function.
 *
 * @param {object}      options
 * @param {HTMLElement} options.popup           - The consent banner element.
 * @param {HTMLElement} options.acceptButton    - "Yes" / accept button.
 * @param {HTMLElement} options.rejectButton    - "No" / reject button (redirects away).
 * @param {HTMLElement} options.infoButton      - Opens the cookie info modal.
 * @param {HTMLElement} options.infoModal       - The info modal dialog.
 * @param {HTMLElement} options.infoCloseButton - Closes the info modal.
 * @param {HTMLElement} options.bearButton      - Resets the stored consent decision.
 * @param {HTMLElement} [options.body]          - The page body (used for blur class).
 * @returns {() => void} A cleanup function that removes all added listeners.
 */
export function initCookieConsent({
  popup,
  acceptButton,
  rejectButton,
  infoButton,
  infoModal,
  infoCloseButton,
  bearButton,
  body = document.body,
}) {
  // Nothing to do if the popup element does not exist on this page.
  if (!popup) {
    return () => {};
  }

  /**
   * The element that had focus before the info modal opened.
   * Stored so we can return focus to the right place when it closes.
   */
  let lastFocusedElement = null;

  // ---------------------------------------------------------------------------
  // Page interaction state
  // ---------------------------------------------------------------------------

  /**
   * Unblur the page and hide the consent popup — called after the visitor
   * accepts cookies or when a stored acceptance is detected on load.
   */
  function enablePageInteraction() {
    body?.classList.remove('blur');
    hidePopup(popup);
  }

  /**
   * Blur the page background and show the consent popup — called when no
   * stored consent is found.
   */
  function disablePageInteraction() {
    body?.classList.add('blur');
    showPopup(popup);
  }

  // ---------------------------------------------------------------------------
  // Info modal
  // ---------------------------------------------------------------------------

  /**
   * Open the cookie info modal and move keyboard focus inside it.
   * The previously focused element is saved so we can restore focus on close.
   */
  function openCookieInfo() {
    if (!infoModal) {
      return;
    }

    lastFocusedElement = document.activeElement;
    infoModal.classList.add('open');
    infoModal.setAttribute('aria-hidden', 'false');
    infoCloseButton?.focus();
  }

  /**
   * Close the cookie info modal and return focus to where it was before.
   */
  function closeCookieInfo() {
    if (!infoModal) {
      return;
    }

    infoModal.classList.remove('open');
    infoModal.setAttribute('aria-hidden', 'true');

    // Return focus to the element that was active before the modal opened.
    // Fall back to the info button if that element is no longer focusable.
    const canReturnFocus =
      lastFocusedElement && typeof lastFocusedElement.focus === 'function';

    const focusTarget = canReturnFocus ? lastFocusedElement : infoButton;
    focusTarget?.focus?.();

    lastFocusedElement = null;
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  /** Store consent and unlock the page. */
  function handleAccept() {
    setCookie(COOKIE_NAME, COOKIE_ACCEPTED_VALUE, 365);
    enablePageInteraction();
  }

  /**
   * Send the visitor to an external page rather than keeping them on a site
   * they have chosen not to allow cookies for.
   */
  function handleReject() {
    window.location.href = 'https://www.google.com/search?q=cookies';
  }

  /** Open the info modal when the info button is pressed. */
  function handleInfoButtonClick() {
    openCookieInfo();
  }

  /** Close the info modal when the close button is pressed. */
  function handleInfoCloseClick() {
    closeCookieInfo();
  }

  /**
   * Close the info modal when the visitor clicks the dark area outside it.
   * Only fires when the click lands directly on the modal backdrop, not its
   * children.
   *
   * @param {MouseEvent} event
   */
  function handleModalBackgroundClick(event) {
    if (event.target === infoModal) {
      closeCookieInfo();
    }
  }

  /**
   * Close the info modal when the visitor presses Escape, matching standard
   * dialog behaviour expected by keyboard users.
   *
   * @param {KeyboardEvent} event
   */
  function handleDocumentKeydown(event) {
    if (event.key === 'Escape' && infoModal?.classList.contains('open')) {
      closeCookieInfo();
    }
  }

  /**
   * Clear all stored consent cookies and re-show the popup so the visitor
   * can make a fresh choice. The bear button acts as a "change my mind" reset.
   */
  function handleBearButtonClick() {
    COOKIE_NAMES_TO_CLEAR.forEach(deleteCookie);
    disablePageInteraction();
    popup?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------
  // Startup check
  // ---------------------------------------------------------------------------

  // If consent was already granted in a previous visit, unlock the page
  // immediately without showing the popup.
  const hasConsent = getCookie(COOKIE_NAME) === COOKIE_ACCEPTED_VALUE;

  if (hasConsent) {
    enablePageInteraction();
  } else {
    disablePageInteraction();
  }

  // ---------------------------------------------------------------------------
  // Bind listeners
  // ---------------------------------------------------------------------------

  acceptButton?.addEventListener('click', handleAccept);
  rejectButton?.addEventListener('click', handleReject);
  infoButton?.addEventListener('click', handleInfoButtonClick);
  infoCloseButton?.addEventListener('click', handleInfoCloseClick);
  infoModal?.addEventListener('click', handleModalBackgroundClick);
  document.addEventListener('keydown', handleDocumentKeydown);
  bearButton?.addEventListener('click', handleBearButtonClick);

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  return () => {
    acceptButton?.removeEventListener('click', handleAccept);
    rejectButton?.removeEventListener('click', handleReject);
    infoButton?.removeEventListener('click', handleInfoButtonClick);
    infoCloseButton?.removeEventListener('click', handleInfoCloseClick);
    infoModal?.removeEventListener('click', handleModalBackgroundClick);
    document.removeEventListener('keydown', handleDocumentKeydown);
    bearButton?.removeEventListener('click', handleBearButtonClick);
  };
}
