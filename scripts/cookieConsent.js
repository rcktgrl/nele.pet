const COOKIE_NAME = 'cookieConsent';
const COOKIE_ACCEPTED_VALUE = 'accepted';
const COOKIE_NAMES_TO_CLEAR = ['cookieConsent'];

function getCookie(name) {
  return document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split('=')[1];
}

function setCookie(name, value, daysValid) {
  const expiryDate = new Date();
  expiryDate.setTime(expiryDate.getTime() + daysValid * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Lax`;
}

function deleteCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
}

function hidePopup(popup) {
  popup?.classList.add('hidden');
  popup?.setAttribute('aria-hidden', 'true');
}

function showPopup(popup) {
  popup?.classList.remove('hidden');
  popup?.setAttribute('aria-hidden', 'false');
}

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
    COOKIE_NAMES_TO_CLEAR.forEach(deleteCookie);
    disablePageInteraction();
    popup?.focus({ preventScroll: true });
  };

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
