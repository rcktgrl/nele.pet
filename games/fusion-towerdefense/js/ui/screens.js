function showScreen(name){
  if(!screens[name]){
    console.error(`Screen ${name} not found.`);
    return;
  }
  Object.values(screens).filter(Boolean).forEach(s=>s.classList.remove('active'));
  screens[name].classList.add('active');
  if(name==='gameScreen') resizeCanvas();
  if(name!=='cardShopMenu' && typeof hideCardShopTooltip==='function') hideCardShopTooltip();
  const globalHud=document.getElementById('globalMenuHud');
  if(globalHud) globalHud.style.display=name==='gameScreen'?'none':'block';
}

document.addEventListener('click', e => {
  const target = e.target.closest('button');
  if (!target) return;

  if (target.id === 'progressMenuBtn') {
    if (typeof updateMetaUI === 'function') updateMetaUI();
    showScreen('progressMenu');
    return;
  }

  if (target.id === 'openResearchFromProgressBtn') {
    if (typeof updateMetaUI === 'function') updateMetaUI();
    if (typeof renderResearchTree === 'function') renderResearchTree();
    showScreen('researchMenu');
    return;
  }

  if (target.id === 'openCardShopBtn') {
    if (typeof updateMetaUI === 'function') updateMetaUI();
    if (typeof renderCardResearchShop === 'function') renderCardResearchShop();
    showScreen('cardShopMenu');
    return;
  }

  if (target.id === 'backFromProgressBtn') {
    showScreen('mainMenu');
    return;
  }

  if (target.id === 'backFromCardShopBtn' || target.id === 'backFromResearchBtn') {
    showScreen('progressMenu');
  }
}, { capture: true, passive: true });
