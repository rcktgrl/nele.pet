const storyContent = document.getElementById('story-content');

if (storyContent) {
  const googleDocId = '13_zTWp_cWnmwHUGpvco56Cj-GCbmQKmFdurH-WKjAs8';
  const fallbackUrl = `https://docs.google.com/document/d/${googleDocId}/view`;
  const docTextUrl = `https://docs.google.com/document/d/${googleDocId}/export?format=txt`;

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
  };

  const showError = (extraMessage = '') => {
    storyContent.innerHTML = `<p>We couldn't load the plain-text story automatically. <a href="${fallbackUrl}" target="_blank" rel="noopener">Open the story on Google Docs</a>.${extraMessage}</p>`;
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

      if (/^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)) {
        const htmlError = new Error('html-response');
        htmlError.isHTMLResponse = true;
        throw htmlError;
      }

      let paragraphs = trimmed
        .split(/\n\s*\n/)
        .map((part) => part.trim())
        .filter(Boolean);

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
  fetchStory();
}
