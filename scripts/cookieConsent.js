/**
 * Handles the cookie consent modal, including storing consent, showing extra
 * info, and letting the visitor change their mind.
 */
const COOKIE_NAME = 'cookieConsent';
const COOKIE_ACCEPTED_VALUE = 'accepted';
const COOKIE_NAMES_TO_CLEAR = ['cookieConsent'];

/** Read a cookie value by name. Returns undefined if it cannot be found. */
function getCookie(name) {
  return document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split('=')[1];
}

/** Write a cookie that stays valid for the provided number of days. */
function setCookie(name, value, daysValid) {
  const expiryDate = new Date();
  expiryDate.setTime(expiryDate.getTime() + daysValid * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Lax`;
}

/** Remove a cookie immediately by setting an expired date. */
function deleteCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
}

/** Hide the popup from both visuals and assistive technologies. */
function hidePopup(popup) {
  popup?.classList.add('hidden');
  popup?.setAttribute('aria-hidden', 'true');
}

/** Show the popup and make it accessible to screen readers. */
function showPopup(popup) {
  popup?.classList.remove('hidden');
  popup?.setAttribute('aria-hidden', 'false');
}

/**
 * Wire up the consent popup and return a function that removes all listeners.
 * The UI intentionally focuses on clarity rather than persistence so most
 * behaviour is expressed through small, self-describing helpers.
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
  if (!popup) {
    return () => {};
  }

  let lastFocusedElement = null;

  const enablePageInteraction = () => {
    body?.classList.remove('blur');
    hidePopup(popup);
  };

  const disablePageInteraction = () => {
    body?.classList.add('blur');
    showPopup(popup);
  };

  const openCookieInfo = () => {
    if (!infoModal) {
      return;
    }

    // Preserve focus so we can return the visitor to where they left off.
    lastFocusedElement = document.activeElement;
    infoModal.classList.add('open');
    infoModal.setAttribute('aria-hidden', 'false');
    infoCloseButton?.focus();
  };

  const closeCookieInfo = () => {
    if (!infoModal) {
      return;
    }

    infoModal.classList.remove('open');
    infoModal.setAttribute('aria-hidden', 'true');

    const focusTarget = lastFocusedElement && typeof lastFocusedElement.focus === 'function'
      ? lastFocusedElement
      : infoButton;

    focusTarget?.focus?.();
    lastFocusedElement = null;
  };

  const handleAccept = () => {
    setCookie(COOKIE_NAME, COOKIE_ACCEPTED_VALUE, 365);
    enablePageInteraction();
  };

  const handleReject = () => {
    window.location.href = 'https://www.google.com/search?q=cookies';
  };

  const handleInfoButtonClick = () => {
    openCookieInfo();
  };

  const handleInfoCloseClick = () => {
    closeCookieInfo();
  };

  const handleModalBackgroundClick = (event) => {
    if (event.target === infoModal) {
      closeCookieInfo();
    }
  };

  const handleDocumentKeydown = (event) => {
    if (event.key === 'Escape' && infoModal?.classList.contains('open')) {
      closeCookieInfo();
    }
  };

  const handleBearButtonClick = () => {
    // The bear acts as a "reset" to let visitors reconsider their choice.
    COOKIE_NAMES_TO_CLEAR.forEach(deleteCookie);
    disablePageInteraction();
    popup?.focus({ preventScroll: true });
  };

  // Show or hide the popup depending on whether consent is already stored.
  const hasConsent = getCookie(COOKIE_NAME) === COOKIE_ACCEPTED_VALUE;
  if (hasConsent) {
    enablePageInteraction();
  } else {
    disablePageInteraction();
  }

  acceptButton?.addEventListener('click', handleAccept);
  rejectButton?.addEventListener('click', handleReject);
  infoButton?.addEventListener('click', handleInfoButtonClick);
  infoCloseButton?.addEventListener('click', handleInfoCloseClick);
  infoModal?.addEventListener('click', handleModalBackgroundClick);
  document.addEventListener('keydown', handleDocumentKeydown);
  bearButton?.addEventListener('click', handleBearButtonClick);

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
