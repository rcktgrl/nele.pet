/**
 * pawprints.js
 *
 * The "Paw Prints" guestbook panel. Visitors can leave a short name and
 * message that gets stored in a Supabase table and displayed to everyone.
 *
 * Features:
 * - Fetches the 10 most recent entries and renders them in the panel.
 * - Validates the name and message fields before submitting.
 * - Supports a "Name: message" pattern so visitors who put everything in the
 *   message box still get a proper name extracted.
 * - Escapes all user-supplied content before injecting it into the DOM to
 *   prevent XSS attacks.
 * - Prevents overlapping fetches if the panel is opened multiple times rapidly.
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.5/+esm';

// ---------------------------------------------------------------------------
// Supabase setup
// ---------------------------------------------------------------------------

/**
 * These are public-facing values — the anon key only allows the limited
 * actions permitted by the Supabase Row Level Security policies, so it is
 * safe to include in client-side code.
 */
const SUPABASE_URL      = 'https://lglcvsptwkqxykapepey.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnbGN2c3B0d2txeHlrYXBlcGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwNzQ1NDcsImV4cCI6MjA2MjY1MDU0N30.ci7v2g-5wixuPKnG6wUUO87AsbI1bQ8wzRnHHG9QzIQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------------
// Security: HTML escaping
// ---------------------------------------------------------------------------

/**
 * Replace HTML special characters in a string with their safe entity equivalents.
 * This prevents user-supplied content from being interpreted as markup.
 *
 * @param {string} value - The raw string to escape.
 * @returns {string} The escaped string safe for use in innerHTML.
 */
function escapeHTML(value) {
  const entityMap = {
    '&':  '&amp;',
    '<':  '&lt;',
    '>':  '&gt;',
    '"':  '&quot;',
    "'":  '&#39;',
  };

  return value.replace(/[&<>"']/g, (character) => entityMap[character] ?? character);
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

/**
 * Ensure we always have both a distinct name and message from a raw paw print
 * record. If the visitor left the name field blank, we try to infer a name
 * from a "Name: message" pattern in the message field. If that also fails,
 * the entry is attributed to "Anonymous".
 *
 * @param {{ name?: string, message?: string }} pawPrint - Raw database record.
 * @returns {{ name: string, message: string }}
 */
function normalisePawPrint(pawPrint) {
  const rawMessage = pawPrint.message ?? '';

  // Happy path: an explicit name was provided.
  if (pawPrint.name && pawPrint.name.trim()) {
    return {
      name:    pawPrint.name.trim(),
      message: rawMessage.trim(),
    };
  }

  // Try to split "Name: message" from the message text.
  const colonIndex = rawMessage.indexOf(':');

  if (colonIndex > -1) {
    const possibleName    = rawMessage.slice(0, colonIndex).trim();
    const possibleMessage = rawMessage.slice(colonIndex + 1).trim();

    if (possibleName && possibleMessage) {
      return { name: possibleName, message: possibleMessage };
    }
  }

  // No name available — attribute to Anonymous.
  return { name: 'Anonymous', message: rawMessage.trim() };
}

/**
 * Placeholder for future IP-based moderation.
 * Returns null for now; can be implemented later without changing the call site.
 *
 * @returns {Promise<null>}
 */
async function getUserIP() {
  return null;
}

// ---------------------------------------------------------------------------
// Main initialisation
// ---------------------------------------------------------------------------

/**
 * Mount the paw prints panel and return a cleanup function.
 *
 * @param {object}      options
 * @param {HTMLElement} options.nameInput       - Text input for the visitor's name.
 * @param {HTMLElement} options.messageInput    - Text input for the message.
 * @param {HTMLElement} options.submitButton    - The submit button.
 * @param {HTMLElement} options.feedbackElement - Paragraph for status/error text.
 * @param {HTMLElement} options.listElement     - Container where entries are rendered.
 * @param {HTMLElement} options.openButton      - Button that opens the panel.
 * @param {HTMLElement} options.closeButton     - Button that closes the panel.
 * @param {HTMLElement} options.panelElement    - The panel container element.
 * @returns {() => void} A cleanup function that removes all added listeners.
 */
export function initPawprints({
  nameInput,
  messageInput,
  submitButton,
  feedbackElement,
  listElement,
  openButton,
  closeButton,
  panelElement,
}) {
  // Both the list and panel are required for the feature to make sense.
  if (!listElement || !panelElement) {
    return () => {};
  }

  /** Prevents overlapping Supabase requests when the panel is toggled quickly. */
  let isFetching = false;

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  /**
   * Replace the list contents with a single status paragraph.
   * Used for loading and error states.
   *
   * @param {string} message - Plain text to display.
   */
  function renderStatus(message) {
    listElement.innerHTML = `<p>${message}</p>`;
  }

  /**
   * Render a list of paw print records into the panel.
   * Each record is normalised and its content escaped before being inserted.
   *
   * @param {Array} pawPrints - Array of raw records from Supabase.
   */
  function renderPawPrints(pawPrints) {
    listElement.innerHTML = '';

    pawPrints.forEach((rawEntry) => {
      const { name, message } = normalisePawPrint(rawEntry);

      const container     = document.createElement('div');
      container.className = 'textbox';
      container.innerHTML = `<p><strong>${escapeHTML(name)}</strong>: ${escapeHTML(message)}</p>`;

      listElement.appendChild(container);
    });
  }

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  /**
   * Fetch the 10 most recent paw prints from Supabase and render them.
   * Silently skips the request if a fetch is already in progress.
   */
  async function fetchPawPrints() {
    if (isFetching) {
      return;
    }

    isFetching = true;
    renderStatus('Fetching pawprints...');

    const { data, error } = await supabase
      .from('pawprints')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    isFetching = false;

    if (error) {
      console.error('Error fetching pawprints:', error);
      renderStatus('Could not load paw prints.');
      return;
    }

    if (!data || data.length === 0) {
      renderStatus('No paw prints yet.');
      return;
    }

    renderPawPrints(data);
  }

  // ---------------------------------------------------------------------------
  // Panel open / close
  // ---------------------------------------------------------------------------

  /**
   * Open the paw prints panel and immediately start loading entries.
   */
  function openPanel() {
    panelElement.classList.add('open');

    if (openButton) {
      openButton.style.display = 'none';
    }

    fetchPawPrints();
  }

  /**
   * Close the paw prints panel and restore the open button.
   */
  function closePanel() {
    panelElement.classList.remove('open');

    if (openButton) {
      openButton.style.display = 'flex';
    }
  }

  // ---------------------------------------------------------------------------
  // Submission
  // ---------------------------------------------------------------------------

  /**
   * Validate the form fields and submit a new paw print to Supabase.
   * Shows friendly feedback for validation failures, network errors, and success.
   */
  async function handleSubmit() {
    // Trim whitespace and cap length to keep entries tidy in the database.
    const name    = nameInput?.value.trim().slice(0, 50)  ?? '';
    const message = messageInput?.value.trim().slice(0, 100) ?? '';

    // Validate name.
    if (!name) {
      if (feedbackElement) {
        feedbackElement.textContent = 'Please add your name!';
      }
      return;
    }

    // Validate message.
    if (!message) {
      if (feedbackElement) {
        feedbackElement.textContent = 'Your paw print is empty!';
      }
      return;
    }

    if (feedbackElement) {
      feedbackElement.textContent = 'Sending your paw print…';
    }

    // IP is optional for now; the hook exists so future moderation can use it.
    const ip = await getUserIP();

    // Store the name and message together in a single column using a consistent
    // "Name: message" format so normalisePawPrint can parse it back out.
    const combinedMessage = `${name}: ${message}`;

    const { error } = await supabase
      .from('pawprints')
      .insert({ message: combinedMessage, ip });

    if (error) {
      console.error(error);

      if (feedbackElement) {
        feedbackElement.textContent = 'Something went wrong.';
      }
      return;
    }

    if (feedbackElement) {
      feedbackElement.textContent = 'Paw print submitted!';
    }

    // Clear the form fields after a successful submission.
    if (nameInput)    { nameInput.value    = ''; }
    if (messageInput) { messageInput.value = ''; }

    // Give Supabase a moment to persist the new entry before refreshing the list.
    window.setTimeout(fetchPawPrints, 2000);
  }

  // ---------------------------------------------------------------------------
  // Bind listeners
  // ---------------------------------------------------------------------------

  openButton?.addEventListener('click', openPanel);
  closeButton?.addEventListener('click', closePanel);
  submitButton?.addEventListener('click', handleSubmit);

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  return () => {
    openButton?.removeEventListener('click', openPanel);
    closeButton?.removeEventListener('click', closePanel);
    submitButton?.removeEventListener('click', handleSubmit);
  };
}
