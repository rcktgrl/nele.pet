/**
 * arcade.js
 *
 * Authentication and account management for the Arcade hub page.
 *
 * Visitors must be logged in to access the games. This script handles:
 *  - Displaying an auth overlay (log in / register / forgot password) for
 *    unauthenticated visitors.
 *  - Registering new accounts with an email, username, and password.
 *  - Logging in by username or email.
 *  - Updating passwords and usernames from the account management panel.
 *  - Syncing a new username to the TurboRace leaderboard records.
 *  - Caching the active user in localStorage so the page can render the
 *    "Logged in as …" pill without waiting for an async Supabase call.
 *
 * All Supabase auth operations use the public anon key, which is intentionally
 * visible in client-side code — Row Level Security on the database enforces
 * what each role is actually permitted to do.
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.5/+esm';

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

const SUPABASE_URL      = 'https://lglcvsptwkqxykapepey.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnbGN2c3B0d2txeHlrYXBlcGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwNzQ1NDcsImV4cCI6MjA2MjY1MDU0N30.ci7v2g-5wixuPKnG6wUUO87AsbI1bQ8wzRnHHG9QzIQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------------
// DOM references — auth overlay
// ---------------------------------------------------------------------------

const overlay            = document.getElementById('auth-overlay');
const modeCard           = document.getElementById('auth-mode-card');
const form               = document.getElementById('auth-form');
const formTitle          = document.getElementById('auth-form-title');
const formSubtitle       = document.getElementById('auth-form-subtitle');
const submitButton       = document.getElementById('auth-submit');
const backButton         = document.getElementById('auth-back');
const feedback           = document.getElementById('auth-feedback');
const emailInput         = document.getElementById('auth-email');
const usernameLabel      = document.getElementById('auth-username-label');
const usernameInput      = document.getElementById('auth-username');
const passwordLabel      = document.getElementById('auth-password-label');
const passwordInput      = document.getElementById('auth-password');
const userPill           = document.getElementById('user-pill');
const userControls       = document.getElementById('user-controls');
const forgotPasswordButton = document.getElementById('auth-forgot-password');

// ---------------------------------------------------------------------------
// DOM references — account management overlay
// ---------------------------------------------------------------------------

const accountManageButton          = document.getElementById('account-manage-btn');
const accountOverlay               = document.getElementById('account-overlay');
const accountCloseButton           = document.getElementById('account-close-btn');
const accountFeedback              = document.getElementById('account-feedback');
const accountActionForm            = document.getElementById('account-action-form');
const accountActionLabel           = document.getElementById('account-action-label');
const accountActionInput           = document.getElementById('account-action-input');
const accountActionSubmit          = document.getElementById('account-action-submit');
const changePasswordButton         = document.getElementById('change-password-btn');
const changeUsernameButton         = document.getElementById('change-username-btn');
const accountForgotPasswordButton  = document.getElementById('account-forgot-password-btn');
const logoutButton                 = document.getElementById('logout-btn');

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/**
 * Which auth mode is currently active: 'login', 'register', 'forgot', or null.
 * Used when the auth form is submitted to decide what action to take.
 */
let activeMode = null;

/**
 * Which account action is currently active: 'password', 'username', or null.
 * Used when the account action form is submitted.
 */
let accountAction = null;

// ---------------------------------------------------------------------------
// String normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Sanitise a username by removing any characters that aren't letters, digits,
 * underscores, hyphens, or dots, then trim to the maximum allowed length.
 *
 * @param {string} value - Raw input from the user.
 * @returns {string} A sanitised username (may be empty if all chars were stripped).
 */
function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_\-.]/g, '')
    .slice(0, 24);
}

/**
 * Lowercase a username for case-insensitive database lookups.
 * The stored username keeps its original casing; this is used only for queries.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeUsernameLookup(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Lowercase and trim an email address.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Return true if the value looks like a valid email address.
 * Uses a simple pattern — not RFC-5321 complete, but good enough for UI validation.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// ---------------------------------------------------------------------------
// Local cache helpers
// ---------------------------------------------------------------------------

/**
 * Store basic user info in localStorage so the arcade page can immediately
 * show the "logged in as" pill on the next visit without a Supabase round-trip.
 *
 * @param {string} userId   - Supabase auth user ID.
 * @param {string} username - Display username.
 * @param {string} email    - User's email address.
 */
function cacheArcadeUser(userId, username, email) {
  localStorage.setItem('arcade_user', JSON.stringify({ user_id: userId, name: username, email }));
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Return the currently authenticated Supabase user, or null if nobody is
 * signed in.
 *
 * @returns {Promise<object|null>}
 */
async function getActiveUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user || null;
}

/**
 * Translate a raw Supabase auth error into a friendly message.
 * Catches the most common failure cases (like rate-limiting) and falls back
 * to the raw message for anything else.
 *
 * @param {object} error - Error object returned by a Supabase call.
 * @returns {string}
 */
function friendlyAuthError(error) {
  const msg = String(error?.message || 'Unable to authenticate right now.');

  if (msg.toLowerCase().includes('email rate limit exceeded')) {
    return 'Too many email attempts right now. Please wait a minute, then try again or use Log in if your account already exists.';
  }

  return msg;
}

// ---------------------------------------------------------------------------
// Profile helpers
// ---------------------------------------------------------------------------

/**
 * Write (or update) the visitor's profile row in the arcade_profiles table.
 * Uses upsert so this is safe to call after both registration and login.
 *
 * @param {string} userId   - Supabase auth user ID.
 * @param {string} username
 * @param {string} email
 */
async function upsertProfile(userId, username, email) {
  await supabase
    .from('arcade_profiles')
    .upsert({ id: userId, username, email }, { onConflict: 'id' });
}

/**
 * Fetch the visitor's profile from the database and merge it with any data
 * stored in the user's auth metadata. Metadata takes precedence over the
 * profiles table so that username changes propagate correctly.
 *
 * @param {object} user - Supabase auth user object.
 * @returns {Promise<{ username: string, email: string }>}
 */
async function getProfile(user) {
  const { data } = await supabase
    .from('arcade_profiles')
    .select('username,email')
    .eq('id', user.id)
    .maybeSingle();

  const username = normalizeUsername(user?.user_metadata?.username || data?.username) || 'player';
  const email    = normalizeEmail(user?.email || data?.email);

  return { username, email };
}

// ---------------------------------------------------------------------------
// Arcade state helpers
// ---------------------------------------------------------------------------

/**
 * Show the arcade hub for an authenticated user.
 * Fetches (or constructs) their profile, updates the user pill, and hides
 * the auth overlay.
 *
 * @param {object} user - Supabase auth user object.
 */
async function showArcadeForUser(user) {
  const profile = await getProfile(user);

  cacheArcadeUser(user.id, profile.username, profile.email);

  overlay.hidden       = true;
  userControls.hidden  = false;
  userPill.textContent = `Logged in as ${profile.username} (${profile.email})`;
}

/**
 * Hide the arcade hub and show the auth overlay.
 * Called after logout or when no session is found on page load.
 */
function hideArcadeForAuth() {
  userControls.hidden = true;
  overlay.hidden      = false;
  showModeChooser();
}

// ---------------------------------------------------------------------------
// Auth overlay — mode management
// ---------------------------------------------------------------------------

/**
 * Switch the auth form to the given mode ('login', 'register', or 'forgot').
 * Updates all visible text and adjusts which fields are shown/required.
 *
 * @param {'login'|'register'|'forgot'} mode
 */
function setMode(mode) {
  activeMode = mode;
  feedback.textContent = '';
  form.reset();

  const isRegister = mode === 'register';
  const isForgot   = mode === 'forgot';

  // Update the form title and subtitle for the selected mode.
  if (isRegister) {
    formTitle.textContent    = 'Create your Arcade account';
    formSubtitle.textContent = 'Register once, then use your account across all games.';
    submitButton.textContent = 'Register';
  } else if (isForgot) {
    formTitle.textContent    = 'Reset your password';
    formSubtitle.textContent = 'Enter your account email and we will send a reset link.';
    submitButton.textContent = 'Send reset email';
  } else {
    formTitle.textContent    = 'Log in to Arcade';
    formSubtitle.textContent = 'Log in with your username or email and password.';
    submitButton.textContent = 'Log in';
  }

  // Show/hide and enable/disable fields based on the mode.
  // The forgot-password flow only needs an email, so the other fields are hidden.
  usernameLabel.hidden    = isForgot;
  usernameInput.required  = !isForgot;
  usernameInput.disabled  = isForgot;

  emailInput.parentElement.hidden = isForgot;
  emailInput.required  = isRegister || isForgot;
  emailInput.disabled  = isForgot;

  passwordLabel.hidden    = isForgot;
  passwordInput.required  = !isForgot;
  passwordInput.disabled  = isForgot;

  forgotPasswordButton.hidden = isForgot;

  // Show the form and hide the mode chooser.
  modeCard.hidden = true;
  form.hidden     = false;

  // Focus the most relevant input for this mode.
  const firstInput = (isRegister || isForgot) ? emailInput : usernameInput;
  firstInput.focus();
}

/**
 * Return to the mode chooser screen (the card with "Log in" and "Register"
 * buttons). Shown on initial load and when the visitor presses the back button.
 */
function showModeChooser() {
  activeMode           = null;
  feedback.textContent = '';

  form.hidden     = true;
  modeCard.hidden = false;

  // Reset all field states so nothing is accidentally locked after switching modes.
  passwordLabel.hidden    = false;
  passwordInput.required  = true;
  passwordInput.disabled  = false;

  emailInput.parentElement.hidden = false;
  emailInput.required  = true;
  emailInput.disabled  = false;

  usernameLabel.hidden    = true;
  usernameInput.required  = false;
  usernameInput.disabled  = false;

  forgotPasswordButton.hidden = false;
}

// ---------------------------------------------------------------------------
// Login: resolving a username to an email address
// ---------------------------------------------------------------------------

/**
 * Look up the email address associated with a given username so it can be
 * passed to signInWithPassword (which requires an email, not a username).
 *
 * Tries the arcade_resolve_login_email RPC first. If that function doesn't
 * exist yet (error code PGRST202 — RPC not found), falls back to a direct
 * table query. Any other RPC error is treated as a hard failure.
 *
 * @param {string} username - The raw username entered by the visitor.
 * @returns {Promise<{ email: string, errorMessage: string }>}
 *   On success, email is populated and errorMessage is ''.
 *   On failure, email is '' and errorMessage explains what went wrong.
 */
async function resolveLoginEmail(username) {
  const safeUsername = normalizeUsernameLookup(username);

  if (!safeUsername) {
    return { email: '', errorMessage: 'Please enter your username.' };
  }

  // --- Try the dedicated RPC function first ---
  const { data: rpcData, error: rpcError } = await supabase.rpc('arcade_resolve_login_email', {
    p_username: safeUsername,
  });

  if (!rpcError) {
    if (!rpcData) {
      return {
        email: '',
        errorMessage: 'Username not found. If this is an existing account, try logging in with your email once to refresh your profile.',
      };
    }

    return { email: normalizeEmail(rpcData), errorMessage: '' };
  }

  if (rpcError.code !== 'PGRST202') {
    // A real error from the RPC (not just "function missing") — surface it.
    return { email: '', errorMessage: friendlyAuthError(rpcError) };
  }

  // --- Fallback: direct table lookup (used before the RPC migration is run) ---
  const { data: fallbackProfile, error: fallbackError } = await supabase
    .from('arcade_profiles')
    .select('email')
    .ilike('username', safeUsername)
    .maybeSingle();

  if (fallbackError) {
    return {
      email: '',
      errorMessage:
        'Username login is not available on this branch yet. Please log in with your email, or run the latest Supabase auth migration.',
    };
  }

  if (!fallbackProfile?.email) {
    return {
      email: '',
      errorMessage:
        'Username not found. If this is an existing account, try logging in with your email once to refresh your profile.',
    };
  }

  return { email: normalizeEmail(fallbackProfile.email), errorMessage: '' };
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/**
 * Send a password-reset email to the given address.
 * Validates the email format before making the Supabase call.
 *
 * @param {string}      email         - The address to send the reset link to.
 * @param {HTMLElement} [feedbackTarget=feedback] - Element to show status/error in.
 */
async function sendPasswordReset(email, feedbackTarget = feedback) {
  const safeEmail = normalizeEmail(email);

  if (!isValidEmail(safeEmail)) {
    feedbackTarget.textContent = 'Enter a valid email to reset your password.';
    return;
  }

  feedbackTarget.textContent = 'Sending reset email...';

  const { error } = await supabase.auth.resetPasswordForEmail(safeEmail);

  feedbackTarget.textContent = error
    ? friendlyAuthError(error)
    : 'Password reset email sent. Check your inbox.';
}

// ---------------------------------------------------------------------------
// Account overlay helpers
// ---------------------------------------------------------------------------

/**
 * Open the account management overlay and reset it to its initial state.
 */
function openAccountOverlay() {
  accountOverlay.hidden        = false;
  accountFeedback.textContent  = '';
  accountActionForm.hidden     = true;
  accountActionInput.value     = '';
  accountAction                = null;
}

/**
 * Close the account management overlay and clear any in-progress action.
 */
function closeAccountOverlay() {
  accountOverlay.hidden        = true;
  accountFeedback.textContent  = '';
  accountActionForm.hidden     = true;
  accountActionInput.value     = '';
  accountAction                = null;
}

/**
 * Show the inline action form configured for either 'password' or 'username'.
 *
 * @param {'password'|'username'} action
 */
function prepareAccountAction(action) {
  accountAction               = action;
  accountFeedback.textContent = '';
  accountActionForm.hidden    = false;

  if (action === 'password') {
    accountActionLabel.textContent   = 'New password';
    accountActionInput.type          = 'password';
    accountActionInput.minLength     = 8;
    accountActionInput.maxLength     = 72;
    accountActionInput.autocomplete  = 'new-password';
    accountActionSubmit.textContent  = 'Update password';
  }

  if (action === 'username') {
    accountActionLabel.textContent   = 'New username';
    accountActionInput.type          = 'text';
    accountActionInput.minLength     = 3;
    accountActionInput.maxLength     = 24;
    accountActionInput.autocomplete  = 'username';
    accountActionSubmit.textContent  = 'Update username';
  }

  accountActionInput.value = '';
  accountActionInput.focus();
}

// ---------------------------------------------------------------------------
// Account actions
// ---------------------------------------------------------------------------

/**
 * Change the logged-in user's password via Supabase Auth.
 * Requires a minimum length of 8 characters.
 *
 * @param {string} newPassword
 */
async function updatePassword(newPassword) {
  if (newPassword.length < 8) {
    accountFeedback.textContent = 'Password must be at least 8 characters.';
    return;
  }

  accountFeedback.textContent = 'Updating password...';

  const { error } = await supabase.auth.updateUser({ password: newPassword });

  accountFeedback.textContent = error
    ? friendlyAuthError(error)
    : 'Password changed successfully.';
}

/**
 * Update the logged-in user's username in every place it is stored:
 *  1. The arcade_profiles table
 *  2. The user's Supabase auth metadata
 *  3. The TurboRace leaderboard (via RPC, with a direct table fallback)
 *  4. The local localStorage cache
 *  5. The user pill display text
 *
 * @param {string} newUsername - The desired new username.
 */
async function updateUsernameEverywhere(newUsername) {
  const user = await getActiveUser();

  if (!user) {
    accountFeedback.textContent = 'You must be logged in to change username.';
    return;
  }

  const profile          = await getProfile(user);
  const previousUsername = normalizeUsername(profile.username);
  const safeUsername     = normalizeUsername(newUsername);

  if (!safeUsername || safeUsername.length < 3) {
    accountFeedback.textContent = 'Username must be 3-24 characters (letters, numbers, _, -, .).';
    return;
  }

  if (safeUsername === previousUsername) {
    accountFeedback.textContent = 'That is already your username.';
    return;
  }

  accountFeedback.textContent = 'Updating username...';

  // --- Step 1: Update the arcade_profiles table ---
  const { error: profileError } = await supabase
    .from('arcade_profiles')
    .update({ username: safeUsername })
    .eq('id', user.id);

  if (profileError) {
    accountFeedback.textContent = friendlyAuthError(profileError);
    return;
  }

  // --- Step 2: Update Supabase auth metadata ---
  const { error: metadataError } = await supabase.auth.updateUser({
    data: { username: safeUsername },
  });

  if (metadataError) {
    accountFeedback.textContent = friendlyAuthError(metadataError);
    return;
  }

  // --- Step 3: Sync the new username to leaderboard history via RPC ---
  const { error: leaderboardError } = await supabase.rpc('arcade_sync_username_everywhere', {
    p_user_id:      user.id,
    p_old_username: previousUsername,
    p_new_username: safeUsername,
  });

  // Read the cached email once so we can update the UI and localStorage together.
  const cached     = JSON.parse(localStorage.getItem('arcade_user') || '{}');
  const cachedEmail = normalizeEmail(cached.email || user.email);

  if (leaderboardError) {
    if (leaderboardError.code === 'PGRST202') {
      // The RPC hasn't been deployed yet — fall back to a direct table update.
      const leaderboardTables = ['turborace_leaderboard', 'turboracing_exp_leaderboard'];
      const fallbackErrors = [];

      for (const table of leaderboardTables) {
        const { error: fallbackSyncError } = await supabase
          .from(table)
          .update({ username: safeUsername })
          .eq('user_id', user.id);

        if (fallbackSyncError) {
          fallbackErrors.push(`${table}: ${friendlyAuthError(fallbackSyncError)}`);
        }
      }

      if (fallbackErrors.length) {
        accountFeedback.textContent =
          `${fallbackErrors.join(' | ')} (profile updated, but leaderboard sync failed)`;
        return;
      }

      // Profile and leaderboard updated via fallback — update UI and cache.
      cacheArcadeUser(user.id, safeUsername, cachedEmail);
      userPill.textContent        = `Logged in as ${safeUsername} (${cachedEmail})`;
      accountFeedback.textContent =
        'Username updated. Run the latest Supabase auth migration to sync historical leaderboard names.';
      return;
    }

    // Any other leaderboard error — the profile was already updated, so note that.
    accountFeedback.textContent =
      `${friendlyAuthError(leaderboardError)} (profile updated, but leaderboard sync failed)`;
    return;
  }

  // --- Success: update the local cache and user pill ---
  cacheArcadeUser(user.id, safeUsername, cachedEmail);
  userPill.textContent        = `Logged in as ${safeUsername} (${cachedEmail})`;
  accountFeedback.textContent = 'Username updated and synced to leaderboard history.';
}

// ---------------------------------------------------------------------------
// Login / registration
// ---------------------------------------------------------------------------

/**
 * Validate the form fields and perform the login or registration action for
 * the given mode.
 *
 * For login, the visitor may enter a username or email in the identifier field.
 * If they enter a username, resolveLoginEmail translates it to an email before
 * calling signInWithPassword.
 *
 * @param {'login'|'register'|'forgot'} mode
 */
async function loginOrRegister(mode) {
  const registrationEmail = normalizeEmail(emailInput.value);
  const loginIdentifier   = String(usernameInput.value || '').trim();
  const username          = normalizeUsername(loginIdentifier);
  const password          = passwordInput.value;
  const isForgot          = mode === 'forgot';

  // --- Validate inputs before any network calls ---

  if (mode === 'register' && !isValidEmail(registrationEmail)) {
    feedback.textContent = 'Please enter a valid email address.';
    return;
  }

  if (!isForgot && password.length < 8) {
    feedback.textContent = 'Password must be at least 8 characters.';
    return;
  }

  if (mode === 'register' && !username) {
    feedback.textContent = 'Username is required for registration.';
    return;
  }

  if (mode === 'login' && !loginIdentifier) {
    feedback.textContent = 'Username or email is required for login.';
    return;
  }

  // Forgot-password mode only needs the email — delegate and return.
  if (isForgot) {
    await sendPasswordReset(registrationEmail, feedback);
    return;
  }

  // --- Resolve the login email for the 'login' mode ---

  let loginEmail = registrationEmail;

  if (mode === 'login') {
    if (isValidEmail(loginIdentifier)) {
      // The visitor typed a full email address — use it directly.
      loginEmail = normalizeEmail(loginIdentifier);
    } else if (isValidEmail(registrationEmail)) {
      // The visitor filled the email field separately.
      loginEmail = registrationEmail;
    } else {
      // The identifier looks like a username — look up the associated email.
      const { email, errorMessage } = await resolveLoginEmail(loginIdentifier);

      if (errorMessage) {
        feedback.textContent = errorMessage;
        return;
      }

      loginEmail = email;
    }
  }

  // --- Perform the Supabase auth call ---

  feedback.textContent = mode === 'register' ? 'Creating account...' : 'Logging in...';

  let data, error;

  if (mode === 'register') {
    const result = await supabase.auth.signUp({
      email:    registrationEmail,
      password,
      options:  { data: { username } },
    });
    data  = result.data;
    error = result.error;
  } else {
    const result = await supabase.auth.signInWithPassword({
      email:    loginEmail,
      password,
    });
    data  = result.data;
    error = result.error;
  }

  if (error) {
    feedback.textContent = friendlyAuthError(error);
    return;
  }

  const activeUser = data.user || data.session?.user;

  if (!activeUser) {
    // Registration succeeded but email verification is required before login.
    feedback.textContent = 'Account created. Check your email for the verification link, then log in.';
    return;
  }

  // --- Create or update the profile row ---

  const metadataUsername = normalizeUsername(activeUser.user_metadata?.username);
  const resolvedUsername = mode === 'register'
    ? username
    : metadataUsername || username || 'player';

  const resolvedEmail = normalizeEmail(activeUser.email || registrationEmail || loginEmail);

  await upsertProfile(activeUser.id, resolvedUsername, resolvedEmail);

  feedback.textContent  = 'Success!';
  passwordInput.value   = '';

  await showArcadeForUser(activeUser);
}

// ---------------------------------------------------------------------------
// Event listeners — auth overlay
// ---------------------------------------------------------------------------

/** Handle auth form submission (login / register / forgot). */
form?.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!activeMode) {
    feedback.textContent = 'Please choose Log in or Register first.';
    showModeChooser();
    return;
  }

  await loginOrRegister(activeMode);
});

/** Switch to login mode when the "Log in" card button is clicked. */
document.querySelector('[data-auth-mode="login"]')?.addEventListener('click', () => {
  setMode('login');
});

/** Switch to register mode when the "Register" card button is clicked. */
document.querySelector('[data-auth-mode="register"]')?.addEventListener('click', () => {
  setMode('register');
});

/** Switch to forgot-password mode when the "Forgot password" card button is clicked. */
document.querySelector('[data-auth-mode="forgot"]')?.addEventListener('click', () => {
  setMode('forgot');
});

/** Return to the mode chooser when the back button is pressed. */
backButton?.addEventListener('click', () => {
  showModeChooser();
});

/** Send a password reset email using the email field's current value. */
forgotPasswordButton?.addEventListener('click', async () => {
  await sendPasswordReset(emailInput.value);
});

// ---------------------------------------------------------------------------
// Event listeners — account overlay
// ---------------------------------------------------------------------------

/** Open the account management overlay. */
accountManageButton?.addEventListener('click', () => {
  openAccountOverlay();
});

/** Close the account management overlay. */
accountCloseButton?.addEventListener('click', () => {
  closeAccountOverlay();
});

/** Show the change-password form within the account overlay. */
changePasswordButton?.addEventListener('click', () => {
  prepareAccountAction('password');
});

/** Show the change-username form within the account overlay. */
changeUsernameButton?.addEventListener('click', () => {
  prepareAccountAction('username');
});

/** Send a reset email to the currently logged-in user's address. */
accountForgotPasswordButton?.addEventListener('click', async () => {
  const user = await getActiveUser();
  await sendPasswordReset(user?.email || '', accountFeedback);
});

/** Sign out and return the visitor to the auth overlay. */
logoutButton?.addEventListener('click', async () => {
  accountFeedback.textContent = 'Logging out...';

  await supabase.auth.signOut();
  localStorage.removeItem('arcade_user');

  closeAccountOverlay();
  hideArcadeForAuth();
});

/** Handle submission of the account action form (change password or username). */
accountActionForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (accountAction === 'password') {
    await updatePassword(accountActionInput.value);
    return;
  }

  if (accountAction === 'username') {
    await updateUsernameEverywhere(accountActionInput.value);
  }
});

// ---------------------------------------------------------------------------
// Initialisation — check for an existing session on page load
// ---------------------------------------------------------------------------

const { data: { session } } = await supabase.auth.getSession();

if (session?.user) {
  // The visitor is already logged in — show the arcade immediately.
  await showArcadeForUser(session.user);
} else {
  // No active session — show the auth overlay.
  hideArcadeForAuth();
}
