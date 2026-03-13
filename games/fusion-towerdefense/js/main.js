function bindCanvasEvents() {
  canvas.addEventListener('mousemove', e => {
    if (!screens.gameScreen || !screens.gameScreen.classList.contains('active')) {
      return;
    }

    game.hoveredCell = getCellFromMouse(e);
    updateSelectedTowerStats();
  });

  canvas.addEventListener('mouseleave', () => {
    game.hoveredCell = null;
    updateSelectedTowerStats();
  });

  canvas.addEventListener('click', e => {
    if (
      !screens.gameScreen ||
      !screens.gameScreen.classList.contains('active') ||
      game.gameOver ||
      game.victory
    ) {
      return;
    }

    placeTower(getCellFromMouse(e));
  });
}

function bindMenuButtons() {
  const playBtn = document.getElementById('playBtn');
  const mapMenuBtn = document.getElementById('mapMenuBtn');
  const progressMenuBtn = document.getElementById('progressMenuBtn');
  const openCardShopBtn = document.getElementById('openCardShopBtn');
  const openResearchFromProgressBtn = document.getElementById('openResearchFromProgressBtn');
  const backFromProgressBtn = document.getElementById('backFromProgressBtn');
  const backFromCardShopBtn = document.getElementById('backFromCardShopBtn');
  const backToSelectionScreenBtn = document.getElementById('backToSelectionScreenBtn');
  const openDevResearchBtn = document.getElementById('openDevResearchBtn');
  const backToMenuBtn = document.getElementById('backToMenuBtn');
  const backFromResearchBtn = document.getElementById('backFromResearchBtn');
  const backFromDevResearchBtn = document.getElementById('backFromDevResearchBtn');
  const settingsPlayBtn = document.getElementById('settingsPlayBtn');
  const startWaveBtn = document.getElementById('startWaveBtn');
  const cancelTowerBtn = document.getElementById('cancelTowerBtn');
  const sellModeBtn = document.getElementById('sellModeBtn');
  const leaveRunBtn = document.getElementById('leaveRunBtn');
  const ritualModeBtn = document.getElementById('ritualModeBtn');
  const backFromCardsBtn = document.getElementById('backFromCardsBtn');
  const startRunFromCardsBtn = document.getElementById('startRunFromCardsBtn');
  if (playBtn) {
    playBtn.addEventListener('click', openCardLoadoutScreen);
  }

  if (mapMenuBtn) {
    mapMenuBtn.addEventListener('click', () => showScreen('mapMenu'));
  }

  if (progressMenuBtn) {
    progressMenuBtn.addEventListener('click', () => {
      updateMetaUI();
      showScreen('progressMenu');
    });
  }

  if (openResearchFromProgressBtn) {
    openResearchFromProgressBtn.addEventListener('click', () => {
      updateMetaUI();
      renderResearchTree();
      renderCardResearchShop();
      showScreen('researchMenu');
    });
  }

  if (openCardShopBtn) {
    openCardShopBtn.addEventListener('click', () => {
      updateMetaUI();
      renderCardResearchShop();
      showScreen('cardShopMenu');
    });
  }

  if (backToSelectionScreenBtn) {
    backToSelectionScreenBtn.addEventListener('click', () => {
      window.location.href = '../index.html';
    });
  }

  if (openDevResearchBtn) {
    openDevResearchBtn.addEventListener('click', () => {
      populateDevNodeSelect();
      renderDevTree();
      showScreen('devResearchMenu');
    });
  }

  if (backToMenuBtn) {
    backToMenuBtn.addEventListener('click', () => showScreen('mainMenu'));
  }

  if (backFromResearchBtn) {
    backFromResearchBtn.addEventListener('click', () => showScreen('progressMenu'));
  }

  if (backFromProgressBtn) {
    backFromProgressBtn.addEventListener('click', () => showScreen('mainMenu'));
  }

  if (backFromCardShopBtn) {
    backFromCardShopBtn.addEventListener('click', () => showScreen('progressMenu'));
  }

  if (backFromDevResearchBtn) {
    backFromDevResearchBtn.addEventListener('click', () => {
      renderResearchTree();
      renderCardResearchShop();
      showScreen('researchMenu');
    });
  }

  if (settingsPlayBtn) {
    settingsPlayBtn.addEventListener('click', openCardLoadoutScreen);
  }

  if (startWaveBtn) {
    startWaveBtn.addEventListener('click', toggleWaveAuto);
  }

  if (cancelTowerBtn) {
    cancelTowerBtn.addEventListener('click', () => {
      game.selectedTowerType = null;
      game.sellMode = false;
      resetRitualSelection();
      updateTowerSelectionUI();
      updateSelectedTowerStats();
      setStatus('Auswahl aufgehoben.', false, 2);
    });
  }

  if (sellModeBtn) {
    sellModeBtn.addEventListener('click', () => {
      game.sellMode = !game.sellMode;

      if (game.sellMode) {
        game.selectedTowerType = null;
      }

      updateTowerSelectionUI();
      updateSelectedTowerStats();
      setStatus(
        game.sellMode ? 'Verkaufsmodus aktiv.' : 'Verkaufsmodus deaktiviert.',
        false,
        2
      );
    });
  }
  if (ritualModeBtn) {
    ritualModeBtn.addEventListener('click', () => {
      if (!canUseRitualSystem()) {
        setStatus(
          'Rituale brauchen die Research-Freischaltung und mindestens 500 Best Score.',
          true,
          3
        );
        return;
      }

      if (game.ritualMode) {
        resetRitualSelection();
        return;
      }

      game.ritualMode = true;
      game.sellMode = false;
      game.selectedTowerType = null;
      game.ritualCenterTowerId = null;
      game.ritualSelectedTowerIds = [];
      updateTowerSelectionUI();
      updateSelectedTowerStats();
    });
  }


  if (ui.cardShopUnlockCardSlotBtn) {
    ui.cardShopUnlockCardSlotBtn.addEventListener('click', unlockNextCardSlot);
  }

  if (ui.cardSearchInput) {
    ui.cardSearchInput.addEventListener('input', renderOwnedCardsGrid);
  }

  if (backFromCardsBtn) {
    backFromCardsBtn.addEventListener('click', () => showScreen('mainMenu'));
  }

  if (startRunFromCardsBtn) {
    startRunFromCardsBtn.addEventListener('click', startGame);
  }

  if (leaveRunBtn) {
    leaveRunBtn.addEventListener('click', leaveToMenu);
  }
}

function bindSettingsButtons() {
  const waveLimitMinusBtn = document.getElementById('waveLimitMinus');
  const waveLimitPlusBtn = document.getElementById('waveLimitPlus');
  const terrainMinusBtn = document.getElementById('terrainMinus');
  const terrainPlusBtn = document.getElementById('terrainPlus');
  const pathLengthMinusBtn = document.getElementById('pathLengthMinus');
  const pathLengthPlusBtn = document.getElementById('pathLengthPlus');
  const enemyCountMinusBtn = document.getElementById('enemyCountMinus');
  const enemyCountPlusBtn = document.getElementById('enemyCountPlus');

  if (waveLimitMinusBtn) {
    waveLimitMinusBtn.addEventListener('click', () => {
      ui.waveLimitInput.value = clamp(
        (parseInt(ui.waveLimitInput.value, 10) || 20) - 1,
        1,
        999
      );
      syncSettingsUI();
    });
  }

  if (waveLimitPlusBtn) {
    waveLimitPlusBtn.addEventListener('click', () => {
      ui.waveLimitInput.value = clamp(
        (parseInt(ui.waveLimitInput.value, 10) || 20) + 1,
        1,
        999
      );
      syncSettingsUI();
    });
  }

  if (terrainMinusBtn) {
    terrainMinusBtn.addEventListener('click', () => {
      ui.terrainInput.value = clamp(
        (parseInt(ui.terrainInput.value, 10) || 100) - 5,
        10,
        100
      );
      syncSettingsUI();
    });
  }

  if (terrainPlusBtn) {
    terrainPlusBtn.addEventListener('click', () => {
      ui.terrainInput.value = clamp(
        (parseInt(ui.terrainInput.value, 10) || 100) + 5,
        10,
        100
      );
      syncSettingsUI();
    });
  }

  if (pathLengthMinusBtn) {
    pathLengthMinusBtn.addEventListener('click', () => {
      ui.pathLengthInput.value = clamp(
        (parseInt(ui.pathLengthInput.value, 10) || 40) - 1,
        20,
        50
      );
      syncSettingsUI();
    });
  }

  if (pathLengthPlusBtn) {
    pathLengthPlusBtn.addEventListener('click', () => {
      ui.pathLengthInput.value = clamp(
        (parseInt(ui.pathLengthInput.value, 10) || 40) + 1,
        20,
        50
      );
      syncSettingsUI();
    });
  }

  if (enemyCountMinusBtn) {
    enemyCountMinusBtn.addEventListener('click', () => {
      const value = Math.max(
        1,
        Math.round(((parseFloat(ui.enemyCountInput.value) || 1) - 0.1) * 10) / 10
      );
      ui.enemyCountInput.value = value.toFixed(1).replace(/\.0$/, '');
      syncSettingsUI();
    });
  }

  if (enemyCountPlusBtn) {
    enemyCountPlusBtn.addEventListener('click', () => {
      const value =
        Math.round(((parseFloat(ui.enemyCountInput.value) || 1) + 0.1) * 10) / 10;
      ui.enemyCountInput.value = value.toFixed(1).replace(/\.0$/, '');
      syncSettingsUI();
    });
  }

  if (ui.waveLimitInput) {
    ui.waveLimitInput.addEventListener('input', syncSettingsUI);
  }

  if (ui.terrainInput) {
    ui.terrainInput.addEventListener('input', syncSettingsUI);
  }

  if (ui.pathLengthInput) {
    ui.pathLengthInput.addEventListener('input', syncSettingsUI);
  }

  if (ui.enemyCountInput) {
    ui.enemyCountInput.addEventListener('input', syncSettingsUI);
  }
}

function bindDevResearchButtons() {
  const devNodeSelect = document.getElementById('devNodeSelect');
  const devSaveNodeBtn = document.getElementById('devSaveNodeBtn');
  const devConnectBtn = document.getElementById('devConnectBtn');
  const devDisconnectBtn = document.getElementById('devDisconnectBtn');
  const devResetTreeBtn = document.getElementById('devResetTreeBtn');
  const devExportTreeBtn = document.getElementById('devExportTreeBtn');
  const devCopyExportBtn = document.getElementById('devCopyExportBtn');
  const devMetaCashInput = document.getElementById('devMetaCashInput');
  const devAddMetaCashBtn = document.getElementById('devAddMetaCashBtn');
  if (devNodeSelect) {
    devNodeSelect.addEventListener('change', e => {
      loadDevNodeForm(e.target.value);
    });
  }

  if (devSaveNodeBtn) {
    devSaveNodeBtn.addEventListener('click', () => {
      const id = document.getElementById('devNodeSelect').value;
      const node = getNodeById(id);

      if (!node) {
        return;
      }

      node.title = document.getElementById('devNodeTitle').value;
      node.cost = parseInt(document.getElementById('devNodeCost').value, 10) || 0;
      node.desc = document.getElementById('devNodeDesc').value;
      node.recipe = document.getElementById('devNodeDesc').value;
      node.x = snapToGrid(parseInt(document.getElementById('devNodeX').value, 10) || 0);
      node.y = snapToGrid(parseInt(document.getElementById('devNodeY').value, 10) || 0);

      saveTreeConfig();
      renderDevTree();
      renderResearchTree();
      populateDevNodeSelect();
      loadDevNodeForm(id);
      updateResearchExportOutput();
    });
  }

  if (devConnectBtn) {
    devConnectBtn.addEventListener('click', () => {
      if (devSelectedNodeIds.length < 2) {
        return;
      }

      const [from, to] = devSelectedNodeIds.slice(-2);

      if (!researchEdges.some(e => e.from === from && e.to === to)) {
        researchEdges.push({ from, to });
        saveTreeConfig();
        renderDevTree();
        renderResearchTree();
        updateResearchExportOutput();
      }
    });
  }

  if (devDisconnectBtn) {
    devDisconnectBtn.addEventListener('click', () => {
      if (devSelectedNodeIds.length < 2) {
        return;
      }

      const [from, to] = devSelectedNodeIds.slice(-2);
      const before = researchEdges.length;

      researchEdges = researchEdges.filter(e => !(e.from === from && e.to === to));

      if (researchEdges.length !== before) {
        saveTreeConfig();
        renderDevTree();
        renderResearchTree();
        updateResearchExportOutput();
      }
    });
  }

  if (devResetTreeBtn) {
    devResetTreeBtn.addEventListener('click', () => {
      researchNodes = DEFAULT_RESEARCH_NODES.map(n => ({ ...n }));
      researchEdges = DEFAULT_RESEARCH_EDGES.map(e => ({ ...e }));
      saveTreeConfig();
      populateDevNodeSelect();
      renderDevTree();
      renderResearchTree();
      updateResearchExportOutput();
    });
  }

  if (devExportTreeBtn) {
    devExportTreeBtn.addEventListener('click', () => {
      updateResearchExportOutput();
      setStatus(
        'Tree-Export erzeugt. Du kannst ihn jetzt nach js/data/research.js kopieren.',
        false,
        3
      );
    });
  }

  if (devCopyExportBtn) {
    devCopyExportBtn.addEventListener('click', () => {
      updateResearchExportOutput();
      copyResearchExportToClipboard();
    });
  }
  if (devAddMetaCashBtn) {
  devAddMetaCashBtn.addEventListener('click', () => {
    const amount = parseInt(devMetaCashInput?.value, 10) || 0;
    if (amount <= 0) {
      setStatus('Gib eine positive Menge Meta-Cash ein.', true, 2.5);
      return;
    }

    metaProgress.cash += amount;
    saveMeta();
    updateMetaUI();
    renderResearchTree();
    setStatus(`+${amount} Meta-Cash hinzugefügt.`, false, 2.5);
  });
}
}
function loop(ts) {
  if (!game.lastTime) {
    game.lastTime = ts;
  }

  const dt = Math.min(0.033, (ts - game.lastTime) / 1000);
  game.lastTime = ts;

  update(dt);
  draw();

  requestAnimationFrame(loop);
}

function runSelfChecks() {
  console.assert(!!screens.mainMenu, 'mainMenu screen missing');
  console.assert(!!screens.mapMenu, 'mapMenu screen missing');
  console.assert(!!screens.researchMenu, 'researchMenu screen missing');
  console.assert(!!screens.devResearchMenu, 'devResearchMenu screen missing');
  console.assert(!!screens.gameScreen, 'gameScreen screen missing');
  console.assert(typeof showScreen === 'function', 'showScreen missing');
  console.assert(getScoreMultiplierForPathLength(20) === 1.3, 'path length multiplier 20 broken');
  console.assert(getScoreMultiplierForPathLength(40) === 1, 'path length multiplier 40 broken');
  console.assert(getScoreMultiplierForPathLength(50) === 0.8, 'path length multiplier 50 broken');

  showScreen('mainMenu');
  showScreen('researchMenu');
  showScreen('devResearchMenu');
  showScreen('gameScreen');
  showScreen('mainMenu');
}

function bootGame() {
  loadMeta();
  loadTreeConfig();
  syncSettingsUI();
  generateMap();
  buildTowerButtons();
  updateMetaUI();
  renderResearchTree();
  populateDevNodeSelect();
  renderDevTree();
  updateResearchExportOutput();
  resizeCanvas();
  runSelfChecks();
  requestAnimationFrame(loop);
}

bindCanvasEvents();
bindMenuButtons();
bindSettingsButtons();
bindDevResearchButtons();

window.addEventListener('resize', resizeCanvas);

bootGame();