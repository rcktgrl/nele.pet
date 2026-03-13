function getCardSlotsUnlockedCount() {
  return CARD_SLOT_UNLOCK_COSTS.filter((_, index) => metaProgress.cardSlotsUnlocked > index).length;
}

function isCardScoreUnlocked(card) {
  return (metaProgress.bestRunScore || 0) >= (card?.unlockScore || 0);
}

function getOwnedCardIds() {
  const owned = Array.isArray(metaProgress.ownedCards) ? metaProgress.ownedCards : [];
  return [...new Set(owned)].filter(cardId => !!getCardDef(cardId));
}

function isCardOwned(cardId) {
  return getOwnedCardIds().includes(cardId);
}

function getCardBuyCost(card) {
  return card?.buyCost || 0;
}

function isCardTowerUnlocked(card) {
  if (!card || !card.towerTypeId) {
    return true;
  }

  const towerDef = getTowerDef(card.towerTypeId);
  if (!towerDef) {
    return false;
  }

  const unlockNodeId = towerDef.unlock?.researchNodeId;
  if (!unlockNodeId) {
    return true;
  }

  return metaProgress.researched[unlockNodeId] !== false;
}

function canBuyCard(card) {
  if (!card || isCardOwned(card.id) || !isCardScoreUnlocked(card) || !isCardTowerUnlocked(card)) {
    return false;
  }

  return metaProgress.cash >= getCardBuyCost(card);
}

function buyCard(cardId) {
  const card = getCardDef(cardId);
  if (!card) {
    return;
  }

  if (!isCardScoreUnlocked(card)) {
    return setStatus(`Karte ${card.name} ist noch nicht verfügbar.`, true, 2.5);
  }

  if (!isCardTowerUnlocked(card)) {
    return setStatus(`Du brauchst zuerst ${card.towerTypeId} Research.`, true, 2.5);
  }

  if (isCardOwned(card.id)) {
    return;
  }

  const cost = getCardBuyCost(card);
  if (metaProgress.cash < cost) {
    return setStatus(`Nicht genug Meta-Cash für ${card.name}.`, true, 2.5);
  }

  metaProgress.cash -= cost;
  metaProgress.ownedCards = [...getOwnedCardIds(), card.id];
  saveMeta();
  updateMetaUI();
  renderCardLoadoutUI();
}

function canUnlockNextCardSlot() {
  const unlocked = metaProgress.cardSlotsUnlocked || 0;
  if (unlocked >= CARD_SLOT_UNLOCK_COSTS.length) {
    return false;
  }

  return metaProgress.cash >= CARD_SLOT_UNLOCK_COSTS[unlocked];
}

function unlockNextCardSlot() {
  const unlocked = metaProgress.cardSlotsUnlocked || 0;
  if (unlocked >= CARD_SLOT_UNLOCK_COSTS.length) {
    return;
  }

  const cost = CARD_SLOT_UNLOCK_COSTS[unlocked];
  if (metaProgress.cash < cost) {
    return setStatus(`Nicht genug Meta-Cash für Slot ${unlocked + 1}.`, true, 2.5);
  }

  metaProgress.cash -= cost;
  metaProgress.cardSlotsUnlocked = unlocked + 1;
  saveMeta();
  updateMetaUI();
  renderCardLoadoutUI();
}

function setCardToSlot(slotIndex, cardId) {
  const unlocked = metaProgress.cardSlotsUnlocked || 0;
  if (slotIndex >= unlocked || slotIndex < 0) {
    return;
  }

  const card = getCardDef(cardId);
  if (!isCardOwned(cardId) || !isCardTowerUnlocked(card)) {
    return;
  }

  const next = [...(metaProgress.cardLoadout || [])];
  const existingIndex = next.indexOf(cardId);
  if (existingIndex >= 0) {
    next[existingIndex] = null;
  }

  next[slotIndex] = cardId;
  metaProgress.cardLoadout = next.slice(0, CARD_SLOT_UNLOCK_COSTS.length);
  saveMeta();
  renderCardLoadoutUI();
}

function moveCardBetweenSlots(fromSlotIndex, toSlotIndex) {
  const unlocked = metaProgress.cardSlotsUnlocked || 0;
  if (
    fromSlotIndex === toSlotIndex ||
    fromSlotIndex < 0 ||
    toSlotIndex < 0 ||
    fromSlotIndex >= unlocked ||
    toSlotIndex >= unlocked
  ) {
    return;
  }

  const next = [...(metaProgress.cardLoadout || [])];
  const movedCard = next[fromSlotIndex] || null;
  if (!movedCard) {
    return;
  }

  next[fromSlotIndex] = next[toSlotIndex] || null;
  next[toSlotIndex] = movedCard;

  metaProgress.cardLoadout = next.slice(0, CARD_SLOT_UNLOCK_COSTS.length);
  saveMeta();
  renderCardLoadoutUI();
}

function clearCardSlot(slotIndex) {
  const next = [...(metaProgress.cardLoadout || [])];
  next[slotIndex] = null;
  metaProgress.cardLoadout = next.slice(0, CARD_SLOT_UNLOCK_COSTS.length);
  saveMeta();
  renderCardLoadoutUI();
}

function getActiveLoadoutCardIds() {
  const unlocked = metaProgress.cardSlotsUnlocked || 0;
  return (metaProgress.cardLoadout || [])
    .slice(0, unlocked)
    .filter(Boolean);
}

const CARD_TOWER_EFFECT_HANDLERS = {
  tower_stat_flat(tower, card) {
    if (card.effect?.stat === 'damage') {
      tower.damage = Math.max(1, Math.round((tower.damage || 0) + (card.effect.amount || 0)));
    }
  },
  tower_stat_multiplier(tower, card) {
    if (card.effect?.stat === 'damage') {
      tower.damage = Math.max(1, Math.round((tower.damage || 0) * (card.effect.multiplier || 1)));
    }
  },
  sniper_kill_haste(tower, card) {
    tower.onKillCooldownMultiplier = card.effect?.cooldownMultiplierAfterKill || 0.25;
  },
  rapid_ammo_reload_boost(tower, card) {
    const ammoMultiplier = card.effect?.ammoMultiplier || 1;
    const reloadSpeedMultiplier = card.effect?.reloadSpeedMultiplier || 1;

    if (tower.magSize != null) {
      tower.magSize = Math.max(1, Math.round(tower.magSize * ammoMultiplier));
      tower.ammo = tower.magSize;
      tower.requiresAmmo = true;
    }

    if (tower.reloadTime != null) {
      tower.reloadTime = tower.reloadTime / Math.max(1, reloadSpeedMultiplier);
    }
  },
  laser_overtuned_lense(tower, card) {
    tower.runtimeTargetingMode = card.effect?.targetingMode || 'first';
    tower.runtimeLaserDamageProfile = {
      values: [...(card.effect?.damageFalloffValues || [])],
      distances: [...(card.effect?.damageFalloffDistances || [])]
    };
  }
};

const CARD_RUN_EFFECT_HANDLERS = {
  start_money_bonus(runState, card) {
    runState.money += card.effect?.amount || 0;
  }
};

function getRunStartMoney() {
  const activeCards = getActiveLoadoutCardIds();
  const runState = { money: 180 };

  for (const cardId of activeCards) {
    const card = getCardDef(cardId);
    if (!card) {
      continue;
    }

    const handler = CARD_RUN_EFFECT_HANDLERS[card.effect?.type];
    if (handler) {
      handler(runState, card);
    }
  }

  return runState.money;
}

function applyCardsToTower(tower) {
  const activeCards = game.activeCards || [];
  const towerTypeId = getTowerTypeId(tower);

  for (const cardId of activeCards) {
    const card = getCardDef(cardId);
    if (!card || card.towerTypeId !== towerTypeId) {
      continue;
    }
    const handler = CARD_TOWER_EFFECT_HANDLERS[card.effect?.type];
    if (handler) {
      handler(tower, card);
    }
  }
}

function renderCardLoadoutSlots() {
  if (!ui.cardLoadoutSlots) {
    return;
  }

  const unlocked = metaProgress.cardSlotsUnlocked || 0;
  const loadout = metaProgress.cardLoadout || [];

  ui.cardLoadoutSlots.innerHTML = '';
  ui.cardLoadoutSlots.style.setProperty('--slot-columns', `${Math.max(1, unlocked)}`);

  if (unlocked === 0) {
    const lockedInfo = document.createElement('div');
    lockedInfo.className = 'card-slot locked center-placeholder';
    lockedInfo.innerHTML = '<div>Keine Slots freigeschaltet.<br>Im Research-Menü freischalten.</div>';
    ui.cardLoadoutSlots.appendChild(lockedInfo);
    return;
  }

  for (let i = 0; i < unlocked; i++) {
    const cardId = loadout[i] || null;
    const card = cardId ? getCardDef(cardId) : null;

    const slot = document.createElement('div');
    slot.className = 'card-slot unlocked';
    slot.dataset.slotIndex = String(i);

    if (!card) {
      slot.innerHTML = `<div>Freier Slot ${i + 1}</div>`;
    } else {
      slot.draggable = true;
      slot.dataset.cardId = card.id;
      slot.innerHTML = `
        <div style="color:${getCardRarityColor(card.rarity)};font-weight:800">${card.name}</div>
        <div class="mini">${card.description}</div>
        <button class="btn small" data-clear-slot="${i}">Entfernen</button>
      `;

      slot.addEventListener('dragstart', event => {
        event.dataTransfer?.setData('application/x-fusion-slot', String(i));
        event.dataTransfer?.setData('application/x-fusion-card', card.id);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
        }
      });
    }

    slot.addEventListener('dragover', event => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      slot.classList.add('drag-over');
    });

    slot.addEventListener('dragleave', () => {
      slot.classList.remove('drag-over');
    });

    slot.addEventListener('drop', event => {
      event.preventDefault();
      slot.classList.remove('drag-over');

      const fromSlotRaw = event.dataTransfer?.getData('application/x-fusion-slot');
      const droppedCardId = event.dataTransfer?.getData('application/x-fusion-card');

      if (fromSlotRaw !== undefined && fromSlotRaw !== '') {
        moveCardBetweenSlots(Number(fromSlotRaw), i);
        return;
      }

      if (droppedCardId) {
        setCardToSlot(i, droppedCardId);
      }
    });

    ui.cardLoadoutSlots.appendChild(slot);
  }

  ui.cardLoadoutSlots.querySelectorAll('[data-clear-slot]').forEach(btn => {
    btn.addEventListener('click', () => {
      clearCardSlot(Number(btn.dataset.clearSlot));
    });
  });
}

function renderOwnedCardsGrid() {
  if (!ui.cardPoolGrid) {
    return;
  }

  const query = (ui.cardSearchInput?.value || '').trim().toLowerCase();
  const cardDefs = getCardDefsArray().filter(card => isCardOwned(card.id) && isCardTowerUnlocked(card));
  const filtered = query
    ? cardDefs.filter(card => card.name.toLowerCase().includes(query))
    : cardDefs;

  ui.cardPoolGrid.innerHTML = '';

  for (const card of filtered) {
    const cardEl = document.createElement('button');
    cardEl.className = 'owned-card';
    cardEl.style.borderColor = getCardRarityColor(card.rarity);
    cardEl.draggable = true;
    cardEl.dataset.cardId = card.id;

    const towerDef = getTowerDef(card.towerTypeId);
    const iconColor = towerDef?.visuals?.color || '#ffffff';

    cardEl.innerHTML = `
      <div class="owned-card-image" style="color:${iconColor}">⬢</div>
      <div class="owned-card-name">${card.name}</div>
      <div class="owned-card-desc">${card.description}</div>
      <div class="owned-card-meta">Freigeschaltet</div>
    `;

    cardEl.addEventListener('dragstart', event => {
      event.dataTransfer?.setData('application/x-fusion-card', card.id);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
    });

    cardEl.addEventListener('click', () => {
      const unlockedSlots = metaProgress.cardSlotsUnlocked || 0;
      const loadout = metaProgress.cardLoadout || [];
      let slotIndex = loadout.findIndex((entry, index) => index < unlockedSlots && !entry);
      if (slotIndex < 0) {
        slotIndex = 0;
      }
      setCardToSlot(slotIndex, card.id);
    });

    ui.cardPoolGrid.appendChild(cardEl);
  }
}


let cardShopTooltipEl = null;

function getCardShopTooltipDetails(card) {
  const lines = [];
  lines.push(`Seltenheit: ${card.rarity}`);
  if (card.towerTypeId) {
    const towerDef = getTowerDef(card.towerTypeId);
    lines.push(`Turm: ${towerDef?.name || card.towerTypeId}`);
  } else {
    lines.push('Turm: Run-weit');
  }

  const effect = card.effect || {};
  if (effect.type === 'tower_stat_multiplier' && effect.stat === 'damage') {
    lines.push(`Effekt: x${effect.multiplier} Schaden`);
  } else if (effect.type === 'tower_stat_flat' && effect.stat === 'damage') {
    lines.push(`Effekt: +${effect.amount} Schaden`);
  } else if (effect.type === 'start_money_bonus') {
    lines.push(`Effekt: +${effect.amount} Startgeld`);
  } else {
    lines.push(`Effekt: ${effect.type || 'Spezialeffekt'}`);
  }

  return lines.join(' · ');
}

function ensureCardShopTooltip() {
  if (cardShopTooltipEl) {
    return cardShopTooltipEl;
  }

  cardShopTooltipEl = document.createElement('div');
  cardShopTooltipEl.className = 'card-shop-tooltip';
  cardShopTooltipEl.style.display = 'none';
  document.body.appendChild(cardShopTooltipEl);
  return cardShopTooltipEl;
}

function hideCardShopTooltip() {
  if (cardShopTooltipEl) {
    cardShopTooltipEl.style.display = 'none';
  }
}

function showCardShopTooltip(card, anchorRect) {
  const tip = ensureCardShopTooltip();
  tip.innerHTML = `
    <div class="card-shop-tooltip-title" style="color:${getCardRarityColor(card.rarity)}">${card.name}</div>
    <div class="card-shop-tooltip-body">${getCardShopTooltipDetails(card)}<br><br>${card.description}</div>
  `;
  tip.style.display = 'block';

  const gap = 10;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tipRect = tip.getBoundingClientRect();

  let left = anchorRect.right + gap;
  if (anchorRect.left > vw / 2) {
    left = anchorRect.left - tipRect.width - gap;
  }

  let top = anchorRect.top + (anchorRect.height - tipRect.height) / 2;

  left = Math.max(8, Math.min(left, vw - tipRect.width - 8));
  top = Math.max(8, Math.min(top, vh - tipRect.height - 8));

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function renderCardResearchShop() {
  if (ui.cardShopUnlockCardSlotBtn) {
    const unlocked = metaProgress.cardSlotsUnlocked || 0;
    if (unlocked >= CARD_SLOT_UNLOCK_COSTS.length) {
      ui.cardShopUnlockCardSlotBtn.textContent = 'Alle Slots freigeschaltet';
      ui.cardShopUnlockCardSlotBtn.disabled = true;
    } else {
      const cost = CARD_SLOT_UNLOCK_COSTS[unlocked];
      ui.cardShopUnlockCardSlotBtn.textContent = `Slot ${unlocked + 1} freischalten ($${cost})`;
      ui.cardShopUnlockCardSlotBtn.disabled = !canUnlockNextCardSlot();
    }
  }

  if (!ui.cardShopGrid) {
    return;
  }

  ui.cardShopGrid.innerHTML = '';

  const cards = getCardDefsArray().filter(card => !isCardOwned(card.id) && isCardTowerUnlocked(card));

  for (const card of cards) {
    const row = document.createElement('div');
    row.className = 'research-card-item';

    const scoreLocked = !isCardScoreUnlocked(card);
    const cost = getCardBuyCost(card);

    const canBuy = canBuyCard(card);

    row.innerHTML = `
      <div class="name" style="color:${getCardRarityColor(card.rarity)}">${card.name}</div>
      <div class="price">$${cost}</div>
      <div class="req">${scoreLocked ? `Benötigt ${card.unlockScore}` : 'Verfügbar'}</div>
      <button class="btn small ${!canBuy ? 'locked' : ''}" data-buy-card="${card.id}" ${!canBuy ? 'disabled' : ''}>Kaufen</button>
    `;

    row.addEventListener('mouseenter', () => showCardShopTooltip(card, row.getBoundingClientRect()));
    row.addEventListener('mousemove', () => showCardShopTooltip(card, row.getBoundingClientRect()));
    row.addEventListener('mouseleave', hideCardShopTooltip);

    ui.cardShopGrid.appendChild(row);
  }

  ui.cardShopGrid.querySelectorAll('[data-buy-card]').forEach(btn => {
    btn.addEventListener('click', () => buyCard(btn.dataset.buyCard));
  });
}

function renderCardLoadoutUI() {
  renderCardLoadoutSlots();
  renderOwnedCardsGrid();
}

function openCardLoadoutScreen() {
  renderCardLoadoutUI();
  showScreen('cardLoadoutMenu');
}
