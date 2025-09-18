import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.5/+esm';

/**
 * Handles the "paw print" guestbook that stores short visitor messages in a
 * Supabase table.
 */
const SUPABASE_URL = 'https://lglcvsptwkqxykapepey.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnbGN2c3B0d2txeHlrYXBlcGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwNzQ1NDcsImV4cCI6MjA2MjY1MDU0N30.ci7v2g-5wixuPKnG6wUUO87AsbI1bQ8wzRnHHG9QzIQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Escape HTML entities to avoid injecting markup when rendering user supplied
 * values. A small handcrafted map keeps the function dependency free.
 */
function escapeHTML(value) {
  return value.replace(/[&<>"']/g, (tag) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[tag] ?? tag));
}

/**
 * Ensure we always have both a name and message. If the user leaves the name
 * blank we attempt to infer it from a "Name: message" pattern.
 */
function normalisePawPrint(pawPrint) {
  const rawMessage = pawPrint.message ?? '';

  if (pawPrint.name && pawPrint.name.trim()) {
    return {
      name: pawPrint.name.trim(),
      message: rawMessage.trim(),
    };
  }

  const colonIndex = rawMessage.indexOf(':');
  if (colonIndex > -1) {
    const possibleName = rawMessage.slice(0, colonIndex).trim();
    const possibleMessage = rawMessage.slice(colonIndex + 1).trim();
    if (possibleName && possibleMessage) {
      return { name: possibleName, message: possibleMessage };
    }
  }

  return { name: 'Anonymous', message: rawMessage.trim() };
}

// Placeholder that can be expanded in the future if IP tracking is needed for moderation.
async function getUserIP() {
  return null;
}

/**
 * Initialise the paw print panel. The function renders messages from Supabase,
 * validates submissions, and returns a cleanup callback that detaches all
 * listeners.
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
  if (!listElement || !panelElement) {
    return () => {};
  }

  let isFetching = false;

  const renderStatus = (message) => {
    if (listElement) {
      listElement.innerHTML = `<p>${message}</p>`;
    }
  };

  const renderPawPrints = (pawPrints) => {
    listElement.innerHTML = '';
    pawPrints.forEach((pawPrint) => {
      const { name, message } = normalisePawPrint(pawPrint);
      const container = document.createElement('div');
      container.className = 'textbox';
      container.innerHTML = `<p><strong>${escapeHTML(name)}</strong>: ${escapeHTML(message)}</p>`;
      listElement.appendChild(container);
    });
  };

  const fetchPawPrints = async () => {
    if (isFetching) {
      // Avoid overlapping requests when the panel is opened repeatedly.
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
  };

  const openPanel = () => {
    panelElement.classList.add('open');
    if (openButton) {
      openButton.style.display = 'none';
    }
    fetchPawPrints();
  };

  const closePanel = () => {
    panelElement.classList.remove('open');
    if (openButton) {
      openButton.style.display = 'flex';
    }
  };

  const handleSubmit = async () => {
    // Keep inputs tidy and avoid excessively long entries.
    const name = nameInput?.value.trim().slice(0, 50) ?? '';
    const message = messageInput?.value.trim().slice(0, 100) ?? '';

    if (!name) {
      if (feedbackElement) {
        feedbackElement.textContent = 'Please add your name!';
      }
      return;
    }

    if (!message) {
      if (feedbackElement) {
        feedbackElement.textContent = 'Your paw print is empty!';
      }
      return;
    }

    if (feedbackElement) {
      feedbackElement.textContent = 'Sending your paw print…';
    }

    // IP collection is optional for now but the hook keeps the call site tidy.
    const ip = await getUserIP();
    const combinedMessage = `${name}: ${message}`;

    const { error } = await supabase.from('pawprints').insert({ message: combinedMessage, ip });

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

    if (nameInput) {
      nameInput.value = '';
    }

    if (messageInput) {
      messageInput.value = '';
    }

    // Give Supabase a moment to persist the entry before refreshing the list.
    window.setTimeout(fetchPawPrints, 2000);
  };

  openButton?.addEventListener('click', openPanel);
  closeButton?.addEventListener('click', closePanel);
  submitButton?.addEventListener('click', handleSubmit);

  return () => {
    openButton?.removeEventListener('click', openPanel);
    closeButton?.removeEventListener('click', closePanel);
    submitButton?.removeEventListener('click', handleSubmit);
  };
}
