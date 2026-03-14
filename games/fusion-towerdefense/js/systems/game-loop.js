function startGame(){syncSettingsUI();const activeCards=getActiveLoadoutCardIds();if(typeof resolveBuyableTowerSelections==='function'){const resolved=resolveBuyableTowerSelections();if(typeof warnIfExpectedBuyableMissing==='function')warnIfExpectedBuyableMissing('rapid','startGame:resolved',resolved,null);}Object.assign(game,{running:true,money:getRunStartMoney(),score:0,runEarnedScore:0,runScorePenaltyMult:0,lives:20,wave:0,maxWaves:mapConfig.waveLimit,selectedTowerType:null,sellMode:false,enemies:[],towers:[],projectiles:[],effects:[],spawnQueue:[],timeUntilNextSpawn:0,intermission:true,intermissionTimer:0,waveInProgress:false,gameOver:false,victory:false,hoveredCell:null,statusTimer:0,fastSpawnAccumulator:0,pendingWaveDefs:[],currentWaveInfo:null,currentMoneyLossPercent:0,baseScoreMultiplier:Math.max(1,mapConfig.scoreMultiplier),roundScoreMultiplier:1,autoWaveStart:false,activeCards});generateMap();for(let i=1;i<=Math.min(3,game.maxWaves);i++)game.pendingWaveDefs.push(generateWavePlan(i));buildTowerButtons();updateHUD();updateWavePreviewUI();updateSelectedTowerStats();updateStartWaveButton();setStatus('Run gestartet. Drücke Start Wave, um die erste Welle zu beginnen.');showScreen('gameScreen')}
function finalizeRun(v){const payout=Math.floor(game.score*(v?1:.5));metaProgress.cash+=payout;metaProgress.bestRunScore=Math.max(metaProgress.bestRunScore||0,game.score||0);saveMeta();updateMetaUI();setStatus(v?`Sieg! +${payout} Meta-Cash.`:`Niederlage. +${payout} Meta-Cash.`,!v)}
function leaveToMenu(){
    game.running=false;
    game.autoWaveStart=false;
    updateStartWaveButton();
    showScreen('mainMenu');
    updateMetaUI()
}
function getTotalScoreMultiplier(){
    return Math.max(1,game.baseScoreMultiplier+game.roundScoreMultiplier+game.runScorePenaltyMult)
}
function updateWaves(dt) {
    if (game.gameOver || game.victory) return;

    if (game.intermission) {
        if (game.autoWaveStart) {
            game.intermissionTimer -= dt;
            if (game.intermissionTimer <= 0) queueWave();
        }
    } else if (game.waveInProgress) {
        if (game.spawnQueue.length > 0) {
            game.timeUntilNextSpawn -= dt;
            if (game.timeUntilNextSpawn <= 0) spawnEnemyFromQueue();
        }

        if (game.spawnQueue.length === 0 && game.enemies.length === 0) {
            game.waveInProgress = false;

            if (game.wave >= game.maxWaves) {
                game.victory = true;
                finalizeRun(true);
            } else {
                game.intermission = true;
                game.intermissionTimer = 7;

                const bonus = 25 + Math.floor(game.wave * 3);
                game.money += bonus;

                const eff = getTotalScoreMultiplier(),
                    gain = Math.round(bonus * .5 * eff);

                game.score += gain;
                game.runEarnedScore += gain;

                updateWavePreviewUI();
                updateStartWaveButton();

                setStatus(
                    game.autoWaveStart
                        ? `Wave ${game.wave} besiegt. Nächste Wave in 7 Sekunden. Bonus +$${bonus}.`
                        : `Wave ${game.wave} besiegt. Bonus +$${bonus}. Drücke Start Wave für die nächste Welle.`
                );
            }
        }
    }
}
function update(dt) {
  if (game.statusTimer > 0) {
    game.statusTimer -= dt;
    if (game.statusTimer <= 0) {
      setStatus('Wähle einen Turm aus und klicke auf eine freie Bauzelle.');
    }
  }

  for (let i = game.effects.length - 1; i >= 0; i--) {
    game.effects[i].life -= dt;
    if (game.effects[i].life <= 0) {
      game.effects.splice(i, 1);
    }
  }

  if (!game.gameOver && !game.victory) {
    for (const t of game.towers) {
      if (t.attackType !== '_beam') continue;
      if ((t.stunTimer || 0) > 0) continue;
      if (!t.TargetId) continue;

      const target = game.enemies.find(e => e.instanceId === t.TargetId);
      if (!target) continue;

      if (Math.hypot(target.x - t.x, target.y - t.y) <= getRangeInPixels(t.range)) {
        const stackRatio = Math.min(1, (t.Stacks || 0) / 40);

        game.effects.push({
          type: '_beam',
          x1: t.x,
          y1: t.y,
          x2: target.x,
          y2: target.y,
          life: dt + 0.02,
          stackRatio
        });

        game.effects.push({
          type: '_hit',
          x: target.x,
          y: target.y,
          life: 0.06,
          stackRatio
        });
      }
    }
  }

  if (screens.gameScreen && screens.gameScreen.classList.contains('active')) {
    updateWaves(dt);
    updateEnemies(dt);

    if (!game.gameOver && !game.victory) {
      updateTowers(dt);
      updateProjectiles(dt);
    }

    updateHUD();
  }
}