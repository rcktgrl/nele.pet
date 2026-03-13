import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.5/+esm';

const SUPABASE_URL = 'https://lglcvsptwkqxykapepey.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnbGN2c3B0d2txeHlrYXBlcGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwNzQ1NDcsImV4cCI6MjA2MjY1MDU0N30.ci7v2g-5wixuPKnG6wUUO87AsbI1bQ8wzRnHHG9QzIQ';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const overlay = document.getElementById('auth-overlay');
const form = document.getElementById('auth-form');
const feedback = document.getElementById('auth-feedback');
const emailInput = document.getElementById('auth-email');
const usernameInput = document.getElementById('auth-username');
const passwordInput = document.getElementById('auth-password');
const userPill = document.getElementById('user-pill');

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_\-.]/g, '').slice(0, 24);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function cacheArcadeUser(userId, username, email) {
  localStorage.setItem('arcade_user', JSON.stringify({ user_id: userId, name: username, email }));
}

async function upsertProfile(userId, username, email) {
  await supabase
    .from('arcade_profiles')
    .upsert({ id: userId, username, email }, { onConflict: 'id' });
}

function friendlyAuthError(error) {
  const msg = String(error?.message || 'Unable to authenticate right now.');
  if (msg.toLowerCase().includes('email rate limit exceeded')) {
    return 'Too many email attempts right now. Please wait a minute, then try again or use Log in if your account already exists.';
  }
  return msg;
}

async function getProfile(user) {
  const { data } = await supabase
    .from('arcade_profiles')
    .select('username,email')
    .eq('id', user.id)
    .maybeSingle();

  const username = normalizeUsername(user?.user_metadata?.username || data?.username) || 'player';
  const email = normalizeEmail(user?.email || data?.email);
  return { username, email };
}

async function showArcadeForUser(user) {
  const profile = await getProfile(user);
  cacheArcadeUser(user.id, profile.username, profile.email);
  overlay.hidden = true;
  userPill.hidden = false;
  userPill.textContent = `Logged in as ${profile.username} (${profile.email})`;
}

async function loginOrRegister(mode) {
  const email = normalizeEmail(emailInput.value);
  const username = normalizeUsername(usernameInput.value);
  const password = passwordInput.value;

  if (!isValidEmail(email)) {
    feedback.textContent = 'Please enter a valid email address.';
    return;
  }

  if (password.length < 8) {
    feedback.textContent = 'Password must be at least 8 characters.';
    return;
  }

  if (mode === 'register' && !username) {
    feedback.textContent = 'Username is required for registration.';
    return;
  }

  feedback.textContent = mode === 'register' ? 'Creating account...' : 'Logging in...';

  const authCall = mode === 'register'
    ? supabase.auth.signUp({ email, password, options: { data: { username } } })
    : supabase.auth.signInWithPassword({ email, password });

  const { data, error } = await authCall;
  if (error) {
    feedback.textContent = friendlyAuthError(error);
    return;
  }

  const activeUser = data.user || data.session?.user;
  if (!activeUser) {
    feedback.textContent = 'Account created. Check your email for the verification link, then log in.';
    return;
  }

  const safeUsername = username || normalizeUsername(activeUser.user_metadata?.username) || 'player';
  await upsertProfile(activeUser.id, safeUsername, email);
  feedback.textContent = 'Success!';
  passwordInput.value = '';
  await showArcadeForUser(activeUser);
}


form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  await loginOrRegister('login');
});

document.querySelector('[data-mode="register"]')?.addEventListener('click', async () => {
  await loginOrRegister('register');
});


const {
  data: { session },
} = await supabase.auth.getSession();
if (session?.user) {
  await showArcadeForUser(session.user);
}
