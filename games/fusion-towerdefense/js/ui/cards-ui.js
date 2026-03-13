function getCardSlotsUnlockedCount() {
  return CARD_SLOT_UNLOCK_COSTS.filter((_, index) => metaProgress.cardSlotsUnlocked > index).length;
}

function getOwnedCardIds() {
  return metaProgress.ownedCards || [];
}

function isCardOwned(cardId) {
  return getOwnedCardIds().includes(cardId);
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
  if (slotIndex >= unlocked) {
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

function applyCardsToTower(tower) {
  const activeCards = game.activeCards || [];
  const towerTypeId = getTowerTypeId(tower);

  for (const cardId of activeCards) {
    const card = getCardDef(cardId);
    if (!card || card.towerTypeId !== towerTypeId) {
      continue;
    }

    if (card.effect?.type === 'tower_stat_multiplier' && card.effect.stat === 'damage') {
      tower.damage = Math.round(tower.damage * (card.effect.multiplier || 1));
    }

    if (card.effect?.type === 'sniper_kill_haste') {
      tower.sniperKillHasteCharges = 0;
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

  for (let i = 0; i < CARD_SLOT_UNLOCK_COSTS.length; i++) {
    const cardId = loadout[i] || null;
    const card = cardId ? getCardDef(cardId) : null;
    const isUnlocked = i < unlocked;

    const slot = document.createElement('div');
    slot.className = `card-slot ${isUnlocked ? 'unlocked' : 'locked'}`;

    if (!isUnlocked) {
      slot.innerHTML = `<div>🔒 Slot ${i + 1}<br><span style="color:var(--muted)">$${CARD_SLOT_UNLOCK_COSTS[i]}</span></div>`;
    } else if (!card) {
      slot.innerHTML = `<div>Leerer Slot ${i + 1}</div>`;
    } else {
      slot.innerHTML = `<div style="color:${getCardRarityColor(card.rarity)};font-weight:800">${card.name}</div><div class="mini">${card.description}</div><button class="btn small" data-clear-slot="${i}">Entfernen</button>`;
    }

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

    const towerDef = getTowerDef(card.towerTypeId);
    const iconColor = towerDef?.visuals?.color || '#ffffff';

    cardEl.innerHTML = `
      <div class="owned-card-image" style="color:${iconColor}">⬢</div>
      <div class="owned-card-name">${card.name}</div>
      <div class="owned-card-desc">${card.description}</div>
    `;

    cardEl.addEventListener('click', () => {
      const unlocked = metaProgress.cardSlotsUnlocked || 0;
      const loadout = metaProgress.cardLoadout || [];
      let slotIndex = loadout.findIndex((entry, index) => index < unlocked && !entry);
      if (slotIndex < 0) {
        slotIndex = 0;
      }
      setCardToSlot(slotIndex, card.id);
    });

    ui.cardPoolGrid.appendChild(cardEl);
  }
}

function renderCardLoadoutUI() {
  renderCardLoadoutSlots();
  renderOwnedCardsGrid();

  if (ui.unlockCardSlotBtn) {
    const unlocked = metaProgress.cardSlotsUnlocked || 0;
    if (unlocked >= CARD_SLOT_UNLOCK_COSTS.length) {
      ui.unlockCardSlotBtn.textContent = 'Alle Slots freigeschaltet';
      ui.unlockCardSlotBtn.disabled = true;
    } else {
      const cost = CARD_SLOT_UNLOCK_COSTS[unlocked];
      ui.unlockCardSlotBtn.textContent = `Slot ${unlocked + 1} freischalten ($${cost})`;
      ui.unlockCardSlotBtn.disabled = !canUnlockNextCardSlot();
    }
  }
}

function openCardLoadoutScreen() {
  renderCardLoadoutUI();
  showScreen('cardLoadoutMenu');
}
