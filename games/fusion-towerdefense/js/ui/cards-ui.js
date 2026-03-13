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

function canBuyCard(card) {
  if (!card || isCardOwned(card.id) || !isCardScoreUnlocked(card)) {
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

  if (!isCardOwned(cardId)) {
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
  const cardDefs = getCardDefsArray().filter(card => isCardOwned(card.id));
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

function renderCardResearchShop() {
  if (ui.researchUnlockCardSlotBtn) {
    const unlocked = metaProgress.cardSlotsUnlocked || 0;
    if (unlocked >= CARD_SLOT_UNLOCK_COSTS.length) {
      ui.researchUnlockCardSlotBtn.textContent = 'Alle Slots freigeschaltet';
      ui.researchUnlockCardSlotBtn.disabled = true;
    } else {
      const cost = CARD_SLOT_UNLOCK_COSTS[unlocked];
      ui.researchUnlockCardSlotBtn.textContent = `Slot ${unlocked + 1} freischalten ($${cost})`;
      ui.researchUnlockCardSlotBtn.disabled = !canUnlockNextCardSlot();
    }
  }

  if (!ui.researchCardShopGrid) {
    return;
  }

  ui.researchCardShopGrid.innerHTML = '';

  const cards = getCardDefsArray().filter(card => !isCardOwned(card.id));

  for (const card of cards) {
    const row = document.createElement('div');
    row.className = 'research-card-item';

    const scoreLocked = !isCardScoreUnlocked(card);
    const cost = getCardBuyCost(card);

    row.innerHTML = `
      <div>
        <div class="name" style="color:${getCardRarityColor(card.rarity)}">${card.name}</div>
        <div class="meta">${card.description}</div>
        <div class="meta">${scoreLocked ? `Benötigt ${card.unlockScore} Best Score` : `Kosten: $${cost}`}</div>
      </div>
      <button class="btn small ${scoreLocked || !canBuyCard(card) ? 'locked' : ''}" data-buy-card="${card.id}" ${scoreLocked ? 'disabled' : ''}>Kaufen</button>
    `;

    ui.researchCardShopGrid.appendChild(row);
  }

  ui.researchCardShopGrid.querySelectorAll('[data-buy-card]').forEach(btn => {
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
