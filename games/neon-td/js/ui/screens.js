function showScreen(name){
  if(!screens[name]){
    console.error(`Screen ${name} not found.`);
    return;
  }
  Object.values(screens).filter(Boolean).forEach(s=>s.classList.remove('active'));
  screens[name].classList.add('active');
  if(name==='gameScreen') resizeCanvas();
}