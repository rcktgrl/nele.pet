/**
 * story.js
 *
 * Fetches the story from a Google Docs plain-text export and renders it as
 * a series of <p> elements on the story page.
 *
 * Google Docs sometimes returns an HTML error page instead of plain text
 * (for example when sharing is set to private). The script detects that case
 * and shows a helpful message alongside backup links to the document.
 *
 * If the fetch succeeds, the backup links stay hidden. If anything fails,
 * they become visible so the visitor can still reach the content.
 */

/** The container where story paragraphs will be injected. */
const storyContent = document.getElementById('story-content');

/** Links shown as a fallback when automatic fetching fails. */
const backupLinks = document.getElementById('story-links');

// ---------------------------------------------------------------------------
// Backup link visibility
// ---------------------------------------------------------------------------

/**
 * Show or hide the backup links section.
 *
 * @param {boolean} visible - True to reveal the links, false to hide them.
 */
function setBackupVisibility(visible) {
  if (!backupLinks) {
    return;
  }

  backupLinks.hidden = !visible;
}

// ---------------------------------------------------------------------------
// Main logic — only run when the story container exists on the page
// ---------------------------------------------------------------------------

if (storyContent) {
  /** The Google Docs document ID for the story. */
  const googleDocId = '13_zTWp_cWnmwHUGpvco56Cj-GCbmQKmFdurH-WKjAs8';

  /** Plain-text export URL for the document. */
  const docTextUrl = `https://docs.google.com/document/d/${googleDocId}/export?format=txt`;

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  /**
   * Render an array of paragraph strings into the story container.
   * Empty strings are skipped. If nothing remains after filtering, a short
   * "story is empty" notice is shown instead.
   *
   * @param {string[]} paragraphs - The paragraphs to render.
   */
  function renderParagraphs(paragraphs) {
    storyContent.innerHTML = '';

    let appended = false;

    paragraphs.forEach((text) => {
      const trimmed = text.trim();

      if (!trimmed) {
        // Skip blank entries that slipped through the split.
        return;
      }

      const paragraphEl       = document.createElement('p');
      paragraphEl.textContent = trimmed;
      storyContent.appendChild(paragraphEl);
      appended = true;
    });

    if (!appended) {
      storyContent.innerHTML = '<p>The story is currently empty.</p>';
    }

    // Hide backup links since the story loaded successfully.
    setBackupVisibility(false);
  }

  /**
   * Show an error message in the story container and reveal the backup links.
   * An optional extra sentence can be appended for more context (for example,
   * a hint about document sharing settings).
   *
   * @param {string} [extraMessage=''] - Additional detail to append.
   */
  function showError(extraMessage = '') {
    storyContent.innerHTML =
      `<p>We couldn't load the plain-text story automatically. ` +
      `Use the backup button below to open it on Google Docs.${extraMessage}</p>`;

    setBackupVisibility(true);
  }

  // ---------------------------------------------------------------------------
  // Paragraph splitting
  // ---------------------------------------------------------------------------

  /**
   * Split a raw text string into an array of non-empty paragraphs.
   *
   * The function tries two strategies:
   *  1. Split on blank lines (double newlines), which is the standard format
   *     produced by a well-formatted Google Doc.
   *  2. If that produces no results, split on single newlines as a fallback
   *     for documents that do not use blank lines between paragraphs.
   *
   * @param {string} text - The trimmed raw text from the document.
   * @returns {string[]} An array of non-empty paragraph strings.
   */
  function splitIntoParagraphs(text) {
    // First attempt: split on blank lines between paragraphs.
    const byBlankLine = text
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (byBlankLine.length) {
      return byBlankLine;
    }

    // Fallback: split on individual newlines for single-spaced documents.
    if (text.includes('\n')) {
      return text
        .split(/\r?\n/)
        .map((part) => part.trim())
        .filter(Boolean);
    }

    // Nothing to split — treat the entire text as one paragraph.
    return [];
  }

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  /**
   * Fetch the story from Google Docs, split it into paragraphs, and render
   * them. Handles network errors and the HTML-response error case gracefully.
   */
  async function fetchStory() {
    try {
      const response = await fetch(docTextUrl);

      if (!response.ok) {
        throw new Error('Story could not be fetched');
      }

      const text    = await response.text();
      const trimmed = text.trim();

      if (!trimmed) {
        // The document exists but has no content yet.
        renderParagraphs([]);
        return;
      }

      // Google Docs sometimes returns an HTML page (e.g. when the document is
      // private). Detect this early and throw a typed error so we can show a
      // tailored hint about sharing settings.
      const isHtmlResponse =
        /^<!doctype html/i.test(trimmed) ||
        /^<html/i.test(trimmed);

      if (isHtmlResponse) {
        const error      = new Error('html-response');
        error.isHTMLResponse = true;
        throw error;
      }

      const paragraphs = splitIntoParagraphs(trimmed);

      if (!paragraphs.length) {
        // Text exists but couldn't be split — render it as a single paragraph.
        renderParagraphs([trimmed]);
        return;
      }

      renderParagraphs(paragraphs);
    } catch (error) {
      console.error(error);

      // If the error was caused by an HTML response, add a sharing settings hint.
      const extra = error?.isHTMLResponse
        ? ' Please make sure the document sharing settings allow anyone with the link to view it.'
        : '';

      showError(extra);
    }
  }

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  // Show a friendly loading message while the fetch is in flight.
  storyContent.innerHTML = '<p>Gathering the story magic…</p>';
  setBackupVisibility(false);
  fetchStory();
}
