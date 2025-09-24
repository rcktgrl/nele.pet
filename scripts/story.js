/**
 * Fetches a story stored in Google Docs and renders it into the story page.
 * The code focuses on graceful fallbacks so visitors can still access the
 * document when automatic fetching fails.
 */
const storyContent = document.getElementById('story-content');
const backupLinks = document.getElementById('story-links');

const setBackupVisibility = (visible) => {
  if (!backupLinks) {
    return;
  }

  backupLinks.hidden = !visible;
};

if (storyContent) {
  const googleDocId = '13_zTWp_cWnmwHUGpvco56Cj-GCbmQKmFdurH-WKjAs8';
  const docTextUrl = `https://docs.google.com/document/d/${googleDocId}/export?format=txt`;

  // Replace the content area with a series of <p> elements, skipping empties.
  const renderParagraphs = (paragraphs) => {
    storyContent.innerHTML = '';
    let appended = false;

    paragraphs.forEach((text) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      const paragraphEl = document.createElement('p');
      paragraphEl.textContent = trimmed;
      storyContent.appendChild(paragraphEl);
      appended = true;
    });

    if (!appended) {
      storyContent.innerHTML = '<p>The story is currently empty.</p>';
    }

    setBackupVisibility(false);
  };

  const showError = (extraMessage = '') => {
    storyContent.innerHTML = `<p>We couldn't load the plain-text story automatically. Use the backup button below to open it on Google Docs.${extraMessage}</p>`;
    setBackupVisibility(true);
  };

  const fetchStory = async () => {
    try {
      const response = await fetch(docTextUrl);
      if (!response.ok) {
        throw new Error('Story could not be fetched');
      }

      const text = await response.text();
      const trimmed = text.trim();

      if (!trimmed) {
        renderParagraphs([]);
        return;
      }

      // The export occasionally returns HTML (for example when access is denied).
      if (/^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)) {
        const htmlError = new Error('html-response');
        htmlError.isHTMLResponse = true;
        throw htmlError;
      }

      let paragraphs = trimmed
        .split(/\n\s*\n/)
        .map((part) => part.trim())
        .filter(Boolean);

      // If the document used single newlines instead of blank lines, fall back
      // to a looser split to keep the story readable.
      if (!paragraphs.length && trimmed.includes('\n')) {
        paragraphs = trimmed
          .split(/\r?\n/)
          .map((part) => part.trim())
          .filter(Boolean);
      }

      if (!paragraphs.length) {
        renderParagraphs([trimmed]);
        return;
      }

      renderParagraphs(paragraphs);
    } catch (error) {
      console.error(error);
      const extra = error?.isHTMLResponse
        ? ' Please make sure the document sharing settings allow anyone with the link to view it.'
        : '';
      showError(extra);
    }
  };

  storyContent.innerHTML = '<p>Gathering the story magic…</p>';
  setBackupVisibility(false);
  fetchStory();
}
