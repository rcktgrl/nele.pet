function setStatus(m, e = false, t = 0) {
  if (ui.statusLine) {
    ui.statusLine.textContent = m;
    ui.statusLine.classList.toggle('error', e);
  }
  game.statusTimer = t;
}

function updateStartWaveButton() {
  if (!startWaveBtn) return;
  startWaveBtn.textContent = game.autoWaveStart ? '⏸ Stop Auto' : '▶ Start Wave';
}

function toggleWaveAuto() {
  if (!game.running || game.gameOver || game.victory) return;

  game.autoWaveStart = !game.autoWaveStart;
  updateStartWaveButton();

  if (game.autoWaveStart && game.intermission && !game.waveInProgress) {
    game.intermissionTimer = 0;
    setStatus(
      game.wave === 0
        ? 'Erste Wave startet jetzt.'
        : 'Automatischer Wave-Start aktiviert.',
      false,
      2
    );
  } else if (!game.autoWaveStart) {
    setStatus(
      game.waveInProgress
        ? 'Auto-Start deaktiviert. Nach dieser Welle wird gewartet.'
        : 'Auto-Start deaktiviert. Drücke Start Wave für die nächste Welle.',
      false,
      2
    );
  }

  updateHUD();
}

function updateMetaUI() {
  ui.metaCashValue.textContent = Math.floor(metaProgress.cash);
  ui.mainMetaCash.textContent = Math.floor(metaProgress.cash);

  const unlocked = [];
  for (const k in metaProgress.researched) {
    if (metaProgress.researched[k]) unlocked.push(k);
  }

  ui.researchCountValue.textContent = unlocked.length;
  ui.researchStatusText.textContent = unlocked.length
    ? `Freigeschaltet: ${unlocked.join(', ')}`
    : 'Noch keine zusätzliche Research freigeschaltet.';

  ui.menuTowerCount.textContent = 4 + (metaProgress.researched.tesla ? 1 : 0);
  renderResearchTree();
  renderCardResearchShop();
}

function syncSettingsUI() {
  const wave = clamp(parseInt(ui.waveLimitInput.value || 20, 10) || 20, 1, 999);
  const terrain = clamp(
    Math.round((parseInt(ui.terrainInput.value || 100, 10) || 100) / 5) * 5,
    10,
    100
  );
  const pathLength = clamp(
    parseInt(ui.pathLengthInput.value || 40, 10) || 40,
    20,
    50
  );
  const enemyCount = Math.max(
    1,
    Math.round((parseFloat(ui.enemyCountInput?.value || 1) || 1) * 10) / 10
  );

  mapConfig.waveLimit = wave;
  mapConfig.terrainPercent = terrain;
  mapConfig.pathLength = pathLength;
  mapConfig.enemyCountMultiplier = enemyCount;
  mapConfig.scoreMultiplier =
    getScoreMultiplierForTerrain(terrain) *
    getScoreMultiplierForPathLength(pathLength) *
    enemyCount;

  ui.waveLimitInput.value = wave;
  ui.terrainInput.value = terrain;
  ui.pathLengthInput.value = pathLength;

  if (ui.enemyCountInput) {
    ui.enemyCountInput.value = enemyCount.toFixed(1).replace(/\.0$/, '');
  }

  ui.menuWaveLimit.textContent = wave;
  ui.settingsWaveLimit.textContent = wave;
  ui.settingsPathLength.textContent = pathLength;

  if (ui.settingsEnemyCount) {
    ui.settingsEnemyCount.textContent = `x${enemyCount
      .toFixed(1)
      .replace(/\.0$/, '')}`;
  }

  ui.scoreMultValue.textContent = `x${mapConfig.scoreMultiplier.toFixed(2)}`;
  ui.mapPreviewText.textContent =
    `Automatisch generierte Neon-Map mit orthogonalem Pfad. ` +
    `Baufläche: ${terrain}% · ` +
    `Pfadlänge: ${pathLength} · ` +
    `Enemy Count: x${enemyCount.toFixed(1).replace(/\.0$/, '')} · ` +
    `Score-Multiplikator: x${mapConfig.scoreMultiplier.toFixed(2)} · ` +
    `Wellenlimit: ${wave}.`;
}

function updateWavePreviewUI() {
  if (!ui.wavePreviewList) return;

  const items = game.pendingWaveDefs.slice(0, 3);

  if (!items.length) {
    ui.wavePreviewList.textContent = 'Keine weiteren Waves geplant.';
    return;
  }

  ui.wavePreviewList.innerHTML = items
    .map(
      (def) =>
        `<strong>Wave ${def.wave}</strong><br>${def.preview}<br><span style="color:var(--muted)">Budget ${def.budget.toFixed(0)} · Gegner-Multi x${def.enemyMultiplier.toFixed(2)}</span>`
    )
    .join('<br><br>');
}

function updateHUD() {
  ui.moneyValue.textContent = Math.floor(game.money);
  ui.scoreValue.textContent = game.score;
  ui.livesValue.textContent = game.lives;
  ui.waveValue.textContent = `${Math.min(game.wave, game.maxWaves)} / ${game.maxWaves}`;

  const eff = getTotalScoreMultiplier();

  if (game.gameOver) {
    ui.topInfo.textContent = 'Run verloren';
    ui.topSubInfo.textContent = `Meta-Auszahlung: ${Math.floor(game.score * 0.5)}`;
  } else if (game.victory) {
    ui.topInfo.textContent = 'Sieg';
    ui.topSubInfo.textContent = `Meta-Auszahlung: ${game.score}`;
  } else if (game.intermission) {
    ui.topInfo.textContent = `Wave ${game.wave} / ${game.maxWaves}`;
    ui.topSubInfo.textContent = game.autoWaveStart
      ? `Nächste Wave in ${Math.ceil(game.intermissionTimer)}s · Score x${eff.toFixed(2)}`
      : `Warte auf ▶ Start Wave · Score x${eff.toFixed(2)}`;
  } else if (game.waveInProgress) {
    ui.topInfo.textContent = `Wave ${game.wave} / ${game.maxWaves}`;
    ui.topSubInfo.textContent =
      `${game.enemies.length + game.spawnQueue.length} Gegner verbleibend · ` +
      `Budget ${game.currentWaveInfo ? Math.floor(game.currentWaveInfo.budget) : 0} · ` +
      `Score x${eff.toFixed(2)}`;
  }
}