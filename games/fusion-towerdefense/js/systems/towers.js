
function getTowerTypeId(t){
  if(!t) return null;
  if(t.towerTypeId) return t.towerTypeId;
  return t.id;
}

function getBuyableTowerSelection(typeId){
  const def = getTowerDef(typeId);
  if(!def || !def.acquire?.buyable) return null;

  return {
    id: def.id,
    name: def.name,
    cost: def.stats.cost,
    range: def.stats.range,
    damage: def.stats.damage,
    fireRate: def.stats.fireRate,
    projectileSpeed: def.stats.projectileSpeed,
    color: def.visuals?.color || '#ffffff'
  };
}

function resolveBuyableTowerSelections(){
  return getTowerDefsArray()
    .filter(def => def.acquire?.buyable)
    .map(def => getBuyableTowerSelection(def.id))
    .filter(Boolean);
}

function validateBuyableTowerSelections(selections, contextLabel='unknown'){
  const list = Array.isArray(selections) ? selections.filter(Boolean) : [];
  const ids = new Set(list.map(t => t.id));

  if (!ids.has('rapid')) {
    const rapidDef = getTowerDef('rapid');
    console.warn(
      `[tower-buyables] Expected "rapid" to be buyable in ${contextLabel}, but it is missing.`,
      {
        ids: [...ids],
        rapidDefExists: !!rapidDef,
        rapidDefBuyable: !!rapidDef?.acquire?.buyable
      }
    );
  }

  return list;
}

function getFusionPreview(typeId, cell = null) {
  if (!cell) return null;

  const ex = game.towers.find(t => t.c === cell.c && t.r === cell.r);
  if (!ex) return null;

  const exTypeId = getTowerTypeId(ex);
  const f = getFusionResult(typeId, exTypeId);
  if (!f) return null;

  return {
    name: f.name,
    towerTypeId: f.towerTypeId,
    damage: f.damage,
    fireRate: f.fireRate,
    range: f.range,
    cost: (ex.sellValue || ex.cost || 0) + (getBuyableTowerSelection(typeId)?.cost || 0),
    note: f.note,
    color: f.targetColor
  };
}
function getTowerSpecialText(t){
    const typeId = getTowerTypeId(t) || t.id;
    const def = getTowerDef(typeId);
    if(!def) return 'Keine Besonderheit.';

    const special = def.special || {};
    const acquire = def.acquire || {};
    const parts = [];

    if(def.classes?.length){
        parts.push(`Klassen: ${def.classes.join(', ')}.`);
    }

    if(acquire.type === 'buy'){
        parts.push('Direkt kaufbar.');
    } else if(acquire.type === 'fusion' && acquire.fusionRecipes?.length){
        const recipeText = acquire.fusionRecipes
        .map(r => r.join(' + '))
        .join(' oder ');
        parts.push(`Fusion: ${recipeText}.`);
    } else if(acquire.type === 'ritual'){
        parts.push('Erhältlich durch Ritual.');
    }

    if(Number.isFinite(special.magSize)){
      parts.push(`Magazin: ${special.magSize}.`);
    }
    if(Number.isFinite(special.reloadTime) && special.reloadTime > 0){
      parts.push(`Nachladezeit: ${special.reloadTime}s.`);
    }
    if(Number.isFinite(special.pelletCount)){
      parts.push(`Pellets: ${special.pelletCount}.`);
    }
    if(Number.isFinite(special.chainCount)){
      parts.push(`Kettenziele: ${special.chainCount}.`);
    }
    if(Array.isArray(special.rampStages) && special.rampStages.length){
      parts.push(`Ramp: ${special.rampStages.join(' → ')}.`);
    }

    if(def.description?.text){
        parts.push(def.description.text);
    }

    return parts.join(' ');
}


function updateSelectedTowerStats() {
  const hovered = game.hoveredCell
    ? game.towers.find(
        t => t.c === game.hoveredCell.c && t.r === game.hoveredCell.r
      )
    : null;
    const ritualPreview = getRitualPreviewForHoveredTower();
    if (ritualPreview) {
        const { resultDef } = ritualPreview;
        const stats = resultDef.stats || {};
        const visuals = resultDef.visuals || {};
        const classesText = resultDef.classes?.length
            ? `<br>Klassen: ${resultDef.classes.join(', ')}`
            : '';

        ui.selectedTowerStats.innerHTML = `
            <strong style="color:${visuals.color || '#ffffff'};">${resultDef.name}</strong><br>
            Schaden: ${stats.damage}<br>
            Feuerrate: ${stats.fireRate.toFixed(2)}s<br>
            Reichweite: ${stats.range >= 99999 ? '∞' : stats.range}${classesText}<br>
            <span style="color:var(--muted)">Ritual-Resultat-Vorschau</span><br>
            <span style="color:var(--muted)">${resultDef.description?.text || ''}</span>
        `;
        return;
    }
  if (!game.selectedTowerType) {
    if (hovered) {
      const hoveredTypeId = getTowerTypeId(hovered);
      const hoveredDef = getTowerDef(hoveredTypeId);
      const hoveredName = hoveredDef?.name || hovered.name || hoveredTypeId;
      const hoveredClasses = hoveredDef?.classes?.length
        ? `<br>Klassen: ${hoveredDef.classes.join(', ')}`
        : '';

      ui.selectedTowerStats.innerHTML = `
        <strong style="color:${hovered.color};">${hoveredName}</strong><br>
        Schaden: ${hovered.damage}<br>
        Feuerrate: ${hovered.fireRate.toFixed(2)}s<br>
        Reichweite: ${hovered.range >= 99999 ? '∞' : hovered.range}${hoveredClasses}<br>
        <span style="color:var(--muted)">${getTowerSpecialText(hovered)}</span>
      `;
      return;
    }

    ui.selectedTowerStats.innerHTML =
      'Wähle links einen Turm aus, um seine Werte oder Fusionen zu sehen.';
    return;
  }

  if (
    hovered &&
    isTowerType(hovered, 'sniper') &&
    ['basic', 'sniper'].includes(game.selectedTowerType)
  ) {
    const previews = [];

    if (
      metaProgress.researched.basesniper &&
      game.selectedTowerType === 'basic'
    ) {
      previews.push({
        name: 'Basesniper',
        damage: 28,
        fireRate: towerTypes.basic.fireRate,
        range: towerTypes.sniper.range,
        note: '28 Schaden, Sniper-Reichweite mit Basic-Feuerrate.',
        color: towerTypes.sniper.color,
        cost: (hovered.sellValue || hovered.cost) + towerTypes.basic.cost
      });
    }

    if (
      metaProgress.researched.longsniper &&
      game.selectedTowerType === 'sniper'
    ) {
      previews.push({
        name: 'Longsniper',
        damage: 50,
        fireRate: 1.8,
        range: '∞',
        note: '50 Schaden, 1.8s Feuerrate, unendliche Reichweite, zielt auf meisten HP, 100% schnellere Projektile.',
        color: '#ff8af0',
        cost: (hovered.sellValue || hovered.cost) + towerTypes.sniper.cost
      });
    }

    if (previews.length) {
      ui.selectedTowerStats.innerHTML = previews
        .map(
          f =>
            `<strong style="color:${f.color};">${f.name}</strong><br>` +
            `Schaden: ${f.damage}<br>` +
            `Feuerrate: ${f.fireRate.toFixed(2)}s<br>` +
            `Reichweite: ${f.range}<br>` +
            `Gesamtinvest: $${f.cost}<br>` +
            `<span style="color:var(--muted)">${f.note}</span>`
        )
        .join('<br><br>');
      return;
    }
  }

  const f = getFusionPreview(game.selectedTowerType, game.hoveredCell);

  if (f) {
    ui.selectedTowerStats.innerHTML =
      `<strong style="color:${f.color};">${f.name}</strong><br>` +
      `Schaden: ${f.damage}<br>` +
      `Feuerrate: ${f.fireRate.toFixed(2)}s<br>` +
      `Reichweite: ${f.range >= 99999 ? '∞' : f.range}<br>` +
      `Gesamtinvest: $${f.cost}<br>` +
      `<span style="color:var(--muted)">${f.note}</span>`;
    return;
  }

  const def = getTowerDef(game.selectedTowerType);
  if (!def) {
    ui.selectedTowerStats.innerHTML =
      'Der ausgewählte Turm ist ungültig. Wähle ihn erneut aus.';
    return;
  }

  const t = getBuyableTowerSelection(game.selectedTowerType) || {
    id: def.id,
    name: def.name,
    cost: def.stats.cost,
    range: def.stats.range,
    damage: def.stats.damage,
    fireRate: def.stats.fireRate,
    projectileSpeed: def.stats.projectileSpeed,
    color: def.visuals?.color || '#ffffff'
  };

  const displayDamage = t.damage;

  const classesText = def?.classes?.length
    ? `<br>Klassen: ${def.classes.join(', ')}`
    : '';

  ui.selectedTowerStats.innerHTML = `
    <strong style="color:${t.color};">${t.name}</strong><br>
    Schaden: ${displayDamage}<br>
    Feuerrate: ${t.fireRate.toFixed(2)}s<br>
    Reichweite: ${t.range}<br>
    Kosten: $${t.cost}${classesText}<br>
    <span style="color:var(--muted)">${getTowerSpecialText(t)}</span>
  `;
}
function buildTowerButtons(){
  ui.towerList.innerHTML='';

  const resolvedBuyables = resolveBuyableTowerSelections();
  const buyableSelections = validateBuyableTowerSelections(
    resolvedBuyables,
    'buildTowerButtons'
  );
  game.buyableTowerSelections = buyableSelections;

  buyableSelections.forEach(t => {
      const def = getTowerDef(t.id);
      if (!def) return;

      const unlockId = def.unlock?.researchNodeId;

      if (unlockId && metaProgress.researched[unlockId] === false) {
        return;
      }

      const b = document.createElement('button');
      b.className = 'tower-btn';
      b.dataset.id = t.id;
      b.innerHTML = `
        <div class="icon" style="color:${t.color};">●</div>
        <div class="name-row">${t.name}</div>
        <div class="cost-tag">$${t.cost}</div>
      `;
      b.addEventListener('click',()=>{
        game.selectedTowerType = def.id;
        game.sellMode = false;
        game.ritualMode = false;
        game.ritualCenterTowerId = null;
        game.ritualSelectedTowerIds = [];
        updateTowerSelectionUI();
        updateSelectedTowerStats();
        setStatus(`${def.name} ausgewählt.`);
      });
      ui.towerList.appendChild(b);
    });

  updateTowerSelectionUI();
  updateSelectedTowerStats();
}
function updateTowerSelectionUI() {
  ui.towerList.querySelectorAll('.tower-btn').forEach(b =>
    b.classList.toggle(
      'active',
      b.dataset.id === game.selectedTowerType && !game.sellMode && !game.ritualMode
    )
  );

  const sellBtn = document.getElementById('sellModeBtn');
  if (sellBtn) {
    sellBtn.classList.toggle('active', game.sellMode);
    sellBtn.style.background = '';
    sellBtn.style.borderColor = '';
    sellBtn.style.boxShadow = '';
    sellBtn.style.color = '';
  }

  const ritualBtn = document.getElementById('ritualModeBtn');
  if (ritualBtn) {
    ritualBtn.classList.toggle('active', game.ritualMode);

    if (game.ritualMode) {
      ritualBtn.style.background = 'rgba(255,102,127,0.18)';
      ritualBtn.style.borderColor = 'rgba(255,102,127,0.72)';
      ritualBtn.style.boxShadow = '0 0 18px rgba(255,102,127,0.28)';
      ritualBtn.style.color = '#ff667f';
    } else {
      ritualBtn.style.background = '';
      ritualBtn.style.borderColor = '';
      ritualBtn.style.boxShadow = '';
      ritualBtn.style.color = '';
    }
  }
}
function createTowerData(t,c,r,x,y){
  const baseTower = {
    ...t,
    damage:t.damage,
    reloadTime:t.reloadTime,
    instanceId:`tower_${Date.now()}_${Math.random().toString(36).slice(2,9)}`,
    towerTypeId:t.id,
    c,r,x,y,
    cooldown:0,
    stunTimer:0,
    reloadTimer:0,
    idleShotTimer:0,
    fusionLevel:0,
    sellValue:t.cost,
    currentTargetId:null,
    runtimeModifiers:[],
    angle:-Math.PI/2
  };

  const tower = applyTowerDefinitionToInstance(baseTower, t.id);
  applyCardsToTower(tower);
  return tower;
}
function applyTowerDefinitionToInstance(tower, towerTypeId) {
  const def = getTowerDef(towerTypeId);
  if (!def) return tower;

  const stats = def.stats || {};
  const visuals = def.visuals || {};
  const special = def.special || {};
  const attackType = special.attackType || 'projectile';
  const runtimeDefaults = special.runtimeDefaults || {};

  tower.towerTypeId = def.id;

  if (stats.range != null) tower.range = stats.range;
  if (stats.damage != null) tower.damage = stats.damage;
  if (stats.fireRate != null) tower.fireRate = stats.fireRate;
  if (stats.projectileSpeed != null) tower.projectileSpeed = stats.projectileSpeed;

  if (visuals.color) tower.color = visuals.color;

  tower.attackType = attackType;

  if (special.projectileLifeMultiplier != null) tower.projectileLifeMultiplier = special.projectileLifeMultiplier; else delete tower.projectileLifeMultiplier;
  if (special.spreadMultiplier != null) tower.spreadMultiplier = special.spreadMultiplier; else delete tower.spreadMultiplier;
  if (special.spreadRandom != null) tower.spreadRandom = special.spreadRandom; else delete tower.spreadRandom;
  if (special.multiHitCount != null) tower.multiHitCount = special.multiHitCount; else delete tower.multiHitCount;
  if (special.noChain) tower.noChain = true; else delete tower.noChain;
  if (special.noReload) tower.noReload = true; else delete tower.noReload;
  if (special.quickRamp) { tower.quickRamp = true; tower.quickSpin = 0; } else { delete tower.quickRamp; delete tower.quickSpin; }

  tower.magSize = special.magSize ?? null;
  tower.reloadTime = special.reloadTime ?? 0;
  tower.requiresAmmo = tower.magSize != null;

  if (special.projectileRadius != null) tower.projectileRadius = special.projectileRadius; else delete tower.projectileRadius;
  if (special.projectileLife != null) tower.projectileLife = special.projectileLife; else delete tower.projectileLife;
  if (special.pierceOncePerEnemy) tower.pierceOncePerEnemy = true; else delete tower.pierceOncePerEnemy;

  tower.currentTargetId = null;

  tower.angle = special.baseAngle ?? (-Math.PI / 2);

  tower.rampStages = Array.isArray(special.rampStages)
    ? [...special.rampStages]
    : null;

  tower.rampStageDuration = special.rampStageDuration ?? null;

  for (const [key, value] of Object.entries(runtimeDefaults)) {
    tower[key] = Array.isArray(value)
      ? [...value]
      : (value && typeof value === 'object')
        ? { ...value }
        : value;
  }

  if (tower.noReload) {
    tower.magSize = 999999;
    tower.ammo = 999999;
    tower.reloadTime = 0;
    tower.requiresAmmo = false;
  } else if (tower.magSize != null) {
    tower.ammo = tower.magSize;
  } else {
    tower.ammo = null;
  }

  return tower;
}

function placeTower(cell) {
  if (!cell) return;

  if (game.ritualMode) {
    const clicked = game.towers.find(t => t.c === cell.c && t.r === cell.r);

    if (!clicked) {
      return setStatus(
        'Für Rituale musst du vorhandene Tower anklicken.',
        true,
        2.5
      );
    }

    if (!game.ritualCenterTowerId) {
      if (!canUseRitualSystem()) {
        return setStatus('Rituale sind noch nicht freigeschaltet.', true, 2.5);
      }

      const rituals = getRitualsForCenterTowerInstance(clicked).filter(
        isRitualUnlocked
      );

      if (!rituals.length) {
        return setStatus('Dieser Tower kann kein Ritualzentrum sein.', true, 2.5);
      }

      game.ritualCenterTowerId = clicked.instanceId;
      game.ritualSelectedTowerIds = [];
      updateTowerSelectionUI();

      return setStatus(
        'Ritualzentrum gewählt. Wähle passende Tower und klicke dann erneut auf das Zentrum.',
        false,
        3
      );
    }

    const center = getRitualCenterTower();

    if (!center) {
      resetRitualSelection();
      return setStatus('Ritualzentrum ist nicht mehr vorhanden.', true, 2.5);
    }

    if (clicked.instanceId === center.instanceId) {
      return tryPerformCurrentRitual();
    }

    if (game.ritualSelectedTowerIds.includes(clicked.instanceId)) {
      game.ritualSelectedTowerIds = game.ritualSelectedTowerIds.filter(
        id => id !== clicked.instanceId
      );
      return setStatus('Tower aus Ritualauswahl entfernt.', false, 2);
    }

    if (!canTowerBeAddedToCurrentRitual(clicked)) {
      return setStatus(
        'Dieser Tower passt mit der aktuellen Auswahl zu keinem gültigen Ritual.',
        true,
        2.5
      );
    }

    game.ritualSelectedTowerIds.push(clicked.instanceId);
    return setStatus('Tower zum Ritual hinzugefügt.', false, 2);
  }

  const ex = game.towers.find(t => t.c === cell.c && t.r === cell.r);

  if (game.sellMode) {
    if (!ex) return setStatus('Hier steht kein Turm zum Verkaufen.', true, 2.5);

    const refund = Math.floor((ex.sellValue || ex.cost) * 0.5);
    game.money += refund;
    game.towers = game.towers.filter(t => t !== ex);

    updateHUD();
    return setStatus(`Turm verkauft für $${refund}.`, false, 2.5);
  }

  if (!game.selectedTowerType) {
    return setStatus('Du musst zuerst einen Turm auswählen.', true, 2.5);
  }

  const t = getBuyableTowerSelection(game.selectedTowerType);
  const key = `${cell.c},${cell.r}`;

  if (game.map.pathSet.has(key)) {
    return setStatus('Auf dem Pfad kann kein Turm gebaut werden.', true, 2.5);
  }

  if (!ex && !game.map.buildableSet.has(key)) {
    return setStatus('Diese Zelle ist kein bebaubares Terrain.', true, 2.5);
  }

  if (ex) {
    const f = getFusionResult(game.selectedTowerType, getTowerTypeId(ex));
    const canApplyFusion = !!f;

    if (canApplyFusion) {


      if (!t) {
        return setStatus('Der ausgewählte Turm ist ungültig. Wähle ihn erneut aus.', true, 2.5);
      }

      const cost = t.cost;

      if (game.money < cost) {
        return setStatus(`Nicht genug Geld für ${f.name}.`, true, 2.5);
      }

      game.money -= cost;
      ex.fusionLevel = 1;
      ex.towerTypeId = f.towerTypeId || ex.towerTypeId;
      ex.sellValue = (ex.sellValue || ex.cost || 0) + cost;

      applyTowerDefinitionToInstance(ex, f.towerTypeId);

      updateHUD();
      updateSelectedTowerStats();
      return setStatus(`Fusioniert: ${f.name}.`, false, 2.5);
    }

    return setStatus('Diese Zelle ist bereits belegt.', true, 2.5);
  }

  if (!t) {
    return setStatus('Der ausgewählte Turm ist ungültig. Wähle ihn erneut aus.', true, 2.5);
  }

  if (game.money < t.cost) {
    return setStatus(`Nicht genug Geld für ${t.name}.`, true, 2.5);
  }

  const x =
    game.map.offsetX + cell.c * game.map.cellSize + game.map.cellSize / 2;
  const y =
    game.map.offsetY + cell.r * game.map.cellSize + game.map.cellSize / 2;

  game.money -= t.cost;

  game.towers.push(
    createTowerData(t, cell.c, cell.r, x, y)
  );

  updateHUD();

  setStatus(`${t.name} gebaut.`, false, 2.5);
}
function updateTowers(dt) {
  for (const tower of game.towers) {
    const attackType = getTowerAttackType(tower);

    tower.cooldown -= dt;
    tower.stunTimer = Math.max(0, (tower.stunTimer || 0) - dt);

    const prevReloadTimer = tower.reloadTimer || 0;
    tower.reloadTimer = Math.max(0, prevReloadTimer - dt);

    tower.idleShotTimer = (tower.idleShotTimer || 0) + dt;

    applyTowerTickRuntimeHandlers(tower, dt, prevReloadTimer);
    runTowerRuntimeHooks('beforeTick', { tower, dt });

    if (tower.stunTimer > 0 || tower.reloadTimer > 0) {
      runTowerRuntimeHooks('afterTick', { tower, dt, skipped: true });
      continue;
    }

    runTowerRuntimeHooks('beforeAcquireTarget', { tower, dt });
    const target = resolveTowerTarget(tower);
    runTowerRuntimeHooks('afterAcquireTarget', { tower, dt, target });

    if (target) {
      const aim = getTowerAimPoint(tower, target);
      if (aim) {
        tower.angle = Math.atan2(aim.y - tower.y, aim.x - tower.x);
      }
    }

    if (tower.cooldown > 0 || !target) {
      runTowerRuntimeHooks('afterTick', { tower, dt, skipped: true, target });
      continue;
    }

    if (!canTowerFireAtTarget(tower, target)) {
      runTowerRuntimeHooks('afterTick', { tower, dt, skipped: true, target });
      continue;
    }

    if (!canTowerSpendShot(tower)) {
      runTowerRuntimeHooks('afterTick', { tower, dt, skipped: true, target });
      continue;
    }

    const firePayload = runTowerRuntimeHooks('beforeFire', {
      tower,
      dt,
      target,
      blocked: false
    });

    if (firePayload?.blocked) {
      runTowerRuntimeHooks('afterTick', { tower, dt, skipped: true, target });
      continue;
    }

    tower.cooldown = getTowerFireCooldown(tower);

    const handler = getAttackHandler(attackType);
    if (!handler) {
      runTowerRuntimeHooks('afterTick', { tower, dt, skipped: true, target });
      continue;
    }

    handler(tower, target);
    applyTowerAfterFireRuntimeHandlers(tower);

    runTowerRuntimeHooks('afterFire', { tower, dt, target });
    runTowerRuntimeHooks('afterTick', { tower, dt, target, skipped: false });
  }
}
function updateProjectiles(dt) {
  if (game.gameOver || game.victory) {
    return;
  }

  for (let i = game.projectiles.length - 1; i >= 0; i--) {
    const projectile = game.projectiles[i];
    const projectileDef = resolveProjectileDef(projectile.projectileTypeId || 'basic_bullet');
    const pipelineHandler = getProjectilePipelineHandler(projectileDef.pipelineType);

    const result = pipelineHandler(projectile, projectileDef, dt) || {};

    if (result.remove) {
      game.projectiles.splice(i, 1);
    }
  }

  for (let i = game.enemies.length - 1; i >= 0; i--) {
    if (game.enemies[i].hp <= 0) {
      registerTowerKillCredit(game.enemies[i].lastHitTowerId || null);
      rewardEnemyKill(game.enemies[i]);
      game.enemies.splice(i, 1);
    }
  }
}

function getCellFromMouse(e){
  if(!game.map) return null;

  const r = canvas.getBoundingClientRect();
  const sx = r.width / canvas.width * (window.devicePixelRatio || 1);
  const sy = r.height / canvas.height * (window.devicePixelRatio || 1);
  const mx = (e.clientX - r.left) / sx;
  const my = (e.clientY - r.top) / sy;
  const c = Math.floor((mx - game.map.offsetX) / game.map.cellSize);
  const row = Math.floor((my - game.map.offsetY) / game.map.cellSize);

  if (c < 0 || row < 0 || c >= game.map.cols || row >= game.map.rows) return null;
  return { c, r: row };
}

function getTowerDefFromInstance(t){
  return getTowerDef(getTowerTypeId(t));
}

function getTowerAttackType(t){
  return getTowerResolvedAttackType(t);
}

function isTowerType(t, typeId){
  return getTowerTypeId(t) === typeId;
}

function getTowerByInstanceId(id) {
  return game.towers.find(t => t.instanceId === id) || null;
}

function getRitualCenterTower() {
  return getTowerByInstanceId(game.ritualCenterTowerId);
}

function resetRitualSelection() {
  game.ritualMode = false;
  game.ritualCenterTowerId = null;
  game.ritualSelectedTowerIds = [];
  updateTowerSelectionUI();
}

function manhattanDistance(a, b) {
  return Math.abs(a.c - b.c) + Math.abs(a.r - b.r);
}

function canUseRitualSystem() {
  return !!metaProgress.researched.rituals && (metaProgress.bestRunScore || 0) >= 500;
}

function getRitualsForCenterTowerInstance(tower) {
  if (!tower) return [];
  return getRitualsForCenterTowerType(getTowerTypeId(tower));
}

function isRitualUnlocked(ritual) {
  const unlock = ritual.unlock || {};
  if (unlock.researchId && !metaProgress.researched[unlock.researchId]) {
    return false;
  }
  if ((metaProgress.bestRunScore || 0) < (unlock.minBestRunScore || 0)) {
    return false;
  }
  return true;
}

function canTowerBeAddedToCurrentRitual(tower) {
  const center = getRitualCenterTower();
  if (!center || !tower) return false;
  if (tower.instanceId === center.instanceId) return false;
  if (game.ritualSelectedTowerIds.includes(tower.instanceId)) return true;

  const nextSelected = [...game.ritualSelectedTowerIds, tower.instanceId]
    .map(getTowerByInstanceId)
    .filter(Boolean);

  const rituals = getRitualsForCenterTowerInstance(center).filter(isRitualUnlocked);

  return rituals.some(ritual => {
    if (nextSelected.length > (ritual.selectionRules?.exactSelectionCount || 0)) {
      return false;
    }

    for (const req of ritual.requirements || []) {
      if (req.type === 'selected_tower_within_manhattan_distance') {
        if (nextSelected.length !== 1) return false;

        const selected = nextSelected[0];
        if (getTowerTypeId(selected) !== req.towerType) return false;
        if (manhattanDistance(center, selected) > req.maxDistance) return false;
      }
    }

    return true;
  });
}

function findMatchingCurrentRitual() {
  const center = getRitualCenterTower();
  if (!center) return null;

  const selected = game.ritualSelectedTowerIds
    .map(getTowerByInstanceId)
    .filter(Boolean);

  const rituals = getRitualsForCenterTowerInstance(center).filter(isRitualUnlocked);

  for (const ritual of rituals) {
    const exactCount = ritual.selectionRules?.exactSelectionCount || 0;
    if (selected.length !== exactCount) {
      continue;
    }

    let matches = true;

    for (const req of ritual.requirements || []) {
      if (req.type === 'selected_tower_within_manhattan_distance') {
        if (selected.length !== 1) {
          matches = false;
          break;
        }

        const s = selected[0];
        if (getTowerTypeId(s) !== req.towerType) {
          matches = false;
          break;
        }

        if (manhattanDistance(center, s) > req.maxDistance) {
          matches = false;
          break;
        }
      }
    }

    if (matches) {
      return ritual;
    }
  }

  return null;
}

function tryPerformCurrentRitual() {
  const center = getRitualCenterTower();
  if (!center) {
    return setStatus('Kein Ritualzentrum ausgewählt.', true, 2.5);
  }

  const ritual = findMatchingCurrentRitual();
  if (!ritual) {
    return setStatus('Kein gültiges Ritual mit dieser exakten Auswahl.', true, 2.5);
  }

  const goldCost = ritual.cost?.gold || 0;
  if (game.money < goldCost) {
    return setStatus('Nicht genug Geld für das Ritual.', true, 2.5);
  }

  const centerPos = { c: center.c, r: center.r, x: center.x, y: center.y };
  const selectedTowers = game.ritualSelectedTowerIds
    .map(getTowerByInstanceId)
    .filter(Boolean);

  game.money -= goldCost;

  const consumedIds = new Set();
  if (ritual.consume?.center) {
    consumedIds.add(center.instanceId);
  }
  if (ritual.consume?.selected) {
    for (const t of selectedTowers) {
      consumedIds.add(t.instanceId);
    }
  }

  let totalSellValue = 0;
  for (const t of game.towers) {
    if (consumedIds.has(t.instanceId)) {
      totalSellValue += t.sellValue || 0;
    }
  }

  game.towers = game.towers.filter(t => !consumedIds.has(t.instanceId));

  const resultDef = towerTypes[ritual.resultTowerType];
  const resultTower = createTowerData(
    resultDef,
    centerPos.c,
    centerPos.r,
    centerPos.x,
    centerPos.y
  );

  resultTower.sellValue = totalSellValue;
  applyTowerDefinitionToInstance(resultTower, ritual.resultTowerType);

  game.towers.push(resultTower);

  resetRitualSelection();
  updateHUD();
  updateSelectedTowerStats();
  setStatus(`Ritual erfolgreich: ${resultDef.name}.`, false, 2.5);
}
function isTowerSelectedForCurrentRitual(tower){
  return !!tower && game.ritualSelectedTowerIds.includes(tower.instanceId);
}

function isTowerCenterOfCurrentRitual(tower){
  return !!tower && game.ritualCenterTowerId === tower.instanceId;
}

function getCurrentRitualCandidateState(tower){
  if(!game.ritualMode || !tower) return 'neutral';

  if(isTowerCenterOfCurrentRitual(tower)) return 'center';
  if(isTowerSelectedForCurrentRitual(tower)) return 'selected';

  const center = getRitualCenterTower();
  if(!center) return 'neutral';
  if(tower.instanceId === center.instanceId) return 'center';

  return canTowerBeAddedToCurrentRitual(tower) ? 'candidate' : 'invalid';
}

function isCurrentRitualExecutable(){
  return !!findMatchingCurrentRitual();
}
function getRitualPreviewForHoveredTower() {
  if (!game.ritualMode) return null;
  if (!game.hoveredCell) return null;

  const hovered = game.towers.find(
    t => t.c === game.hoveredCell.c && t.r === game.hoveredCell.r
  );
  if (!hovered) return null;

  const center = getRitualCenterTower();
  if (!center) return null;
  if (hovered.instanceId === center.instanceId) return null;

  if (!canTowerBeAddedToCurrentRitual(hovered)) return null;

  const currentSelected = game.ritualSelectedTowerIds
    .map(getTowerByInstanceId)
    .filter(Boolean);

  const nextSelected = [...currentSelected, hovered];

  const rituals = getRitualsForCenterTowerInstance(center).filter(isRitualUnlocked);

  for (const ritual of rituals) {
    const exactCount = ritual.selectionRules?.exactSelectionCount || 0;
    if (nextSelected.length !== exactCount) {
      continue;
    }

    let matches = true;

    for (const req of ritual.requirements || []) {
      if (req.type === 'selected_tower_within_manhattan_distance') {
        if (nextSelected.length !== 1) {
          matches = false;
          break;
        }

        const s = nextSelected[0];
        if (getTowerTypeId(s) !== req.towerType) {
          matches = false;
          break;
        }

        if (manhattanDistance(center, s) > req.maxDistance) {
          matches = false;
          break;
        }
      }
    }

    if (matches) {
      const resultDef = getTowerDef(ritual.resultTowerType);
      if (!resultDef) return null;

      return {
        ritual,
        resultDef,
        candidateTower: hovered
      };
    }
  }

  return null;
}

function getEnemyPathProgress(e) {
  if (!game.map || !game.map.pathPoints || !game.map.pathPoints.length) {
    return e.pathIndex || 0;
  }

  const currentIndex = Math.max(0, Math.min(e.pathIndex || 0, game.map.pathPoints.length - 1));
  const nextIndex = Math.min(currentIndex + 1, game.map.pathPoints.length - 1);

  if (nextIndex === currentIndex) {
    return currentIndex;
  }

  const a = game.map.pathPoints[currentIndex];
  const b = game.map.pathPoints[nextIndex];

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq <= 0.0001) {
    return currentIndex;
  }

  const px = e.x - a.x;
  const py = e.y - a.y;

  let t = (px * dx + py * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return currentIndex + t;
}
function getLinearFalloffDamage(distance, values, distances) {
  if (!Array.isArray(values) || !Array.isArray(distances)) return 0;
  if (values.length !== distances.length || values.length === 0) return 0;

  if (distance <= distances[0]) {
    return values[0];
  }

  for (let i = 1; i < distances.length; i++) {
    const d0 = distances[i - 1];
    const d1 = distances[i];
    const v0 = values[i - 1];
    const v1 = values[i];

    if (distance <= d1) {
      const t = (distance - d0) / Math.max(0.0001, d1 - d0);
      return v0 + (v1 - v0) * t;
    }
  }

  return values[values.length - 1];
}

function getLaserDamageAtDistance(tower, enemy) {
  const def = getTowerDefFromInstance(tower);
  const special = def?.special || {};
  const distance = Math.hypot(enemy.x - tower.x, enemy.y - tower.y);

  const profileValues = tower?.runtimeLaserDamageProfile?.values || special.damageFalloffValues || [15, 10, 5, 0];
  const profileDistances = tower?.runtimeLaserDamageProfile?.distances || special.damageFalloffDistances || [100, 160, 200, 250];
  const scaledProfileDistances = profileDistances.map(getRangeInPixels);

  return getLinearFalloffDamage(
    distance,
    profileValues,
    scaledProfileDistances
  );
}
