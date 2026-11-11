/**
 * game-versions.js
 *
 * Shows the current Red Mesa Rally version on its arcade card. The version
 * lives in one place (RMR_VERSION in red-mesa-rally/index.html), so it is read
 * from there instead of being copied here and going stale on every release.
 * If the lookup fails the card simply shows no version.
 */
const label = document.getElementById('rmr-version');
if (label) {
  try {
    const res = await fetch('./red-mesa-rally/index.html', { cache: 'no-cache' });
    const m = (await res.text()).match(/RMR_VERSION\s*=\s*'([^']+)'/);
    if (m) label.textContent = 'v' + m[1];
  } catch { /* offline or blocked: leave the label empty */ }
}
