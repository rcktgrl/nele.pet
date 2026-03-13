import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.5/+esm';

const SUPABASE_URL = 'https://lglcvsptwkqxykapepey.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnbGN2c3B0d2txeHlrYXBlcGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwNzQ1NDcsImV4cCI6MjA2MjY1MDU0N30.ci7v2g-5wixuPKnG6wUUO87AsbI1bQ8wzRnHHG9QzIQ';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const overlay = document.getElementById('auth-overlay');
const form = document.getElementById('auth-form');
const feedback = document.getElementById('auth-feedback');
const usernameInput = document.getElementById('auth-username');
const passwordInput = document.getElementById('auth-password');
const userPill = document.getElementById('user-pill');

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_\-.]/g, '').slice(0, 24);
}

function usernameToEmail(username) {
  return `${normalizeUsername(username)}@arcade.nele.pet`;
}

function cacheArcadeUser(userId, username) {
  localStorage.setItem('arcade_user', JSON.stringify({ user_id: userId, name: username }));
}

async function upsertProfile(userId, username) {
  await supabase.from('arcade_profiles').upsert({ id: userId, username }, { onConflict: 'id' });
}

async function getProfileName(user) {
  const metaName = normalizeUsername(user?.user_metadata?.username);
  if (metaName) return metaName;
  const { data } = await supabase.from('arcade_profiles').select('username').eq('id', user.id).maybeSingle();
  return normalizeUsername(data?.username) || 'player';
}

async function showArcadeForUser(user) {
  const username = await getProfileName(user);
  cacheArcadeUser(user.id, username);
  overlay.hidden = true;
  userPill.hidden = false;
  userPill.textContent = `Logged in as ${username}`;
}

async function loginOrRegister(mode) {
  const username = normalizeUsername(usernameInput.value);
  const password = passwordInput.value;
  if (!username || password.length < 8) {
    feedback.textContent = 'Username required, and password must be at least 8 characters.';
    return;
  }

  feedback.textContent = mode === 'register' ? 'Creating account...' : 'Logging in...';
  const email = usernameToEmail(username);

  const authCall = mode === 'register'
    ? supabase.auth.signUp({ email, password, options: { data: { username } } })
    : supabase.auth.signInWithPassword({ email, password });

  const { data, error } = await authCall;
  if (error) {
    feedback.textContent = error.message;
    return;
  }

  const activeUser = data.user || data.session?.user;
  if (!activeUser) {
    feedback.textContent = 'Account created. If email confirmation is enabled, confirm your account first.';
    return;
  }

  await upsertProfile(activeUser.id, username);
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

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) {
  await showArcadeForUser(session.user);
}
