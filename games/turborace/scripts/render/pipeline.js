export function createRenderPipeline({
  THREE,
  canvas,
  scene,
  clock,
  cameras,
  resizeOverlays,
  frameUpdate,
  getActiveCamera,
  getTrainSplitCams,
  getGState
}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  let _W = window.innerWidth, _H = window.innerHeight;

  function onResize() {
    _W = window.innerWidth;
    _H = window.innerHeight;
    renderer.setSize(_W, _H);
    cameras.forEach(c => {
      c.aspect = _W / _H;
      c.updateProjectionMatrix();
    });
    if (resizeOverlays) resizeOverlays();
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    frameUpdate(dt);

    const splitCams = getTrainSplitCams ? getTrainSplitCams() : [];
    if (getGState && getGState() === 'training' && splitCams.length > 0) {
      // Multi-viewport split-screen for training
      renderer.setScissorTest(true);
      const n = splitCams.length;
      // Pick a grid that fits the screen well (landscape-biased)
      let cols, rows;
      if      (n <= 1) { cols=1; rows=1; }
      else if (n <= 2) { cols=2; rows=1; }
      else if (n <= 4) { cols=2; rows=2; }
      else if (n <= 6) { cols=3; rows=2; }
      else             { cols=4; rows=Math.ceil(n/4); }
      const vw = Math.floor(_W / cols);
      const vh = Math.floor(_H / rows);
      for (let i = 0; i < n; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * vw;
        const y = _H - (row + 1) * vh; // THREE.js y is bottom-up
        renderer.setViewport(x, y, vw, vh);
        renderer.setScissor(x, y, vw, vh);
        splitCams[i].aspect = vw / vh;
        splitCams[i].updateProjectionMatrix();
        renderer.render(scene, splitCams[i]);
      }
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, _W, _H);
    } else {
      renderer.render(scene, getActiveCamera());
    }
  }

  window.addEventListener('resize', onResize);
  onResize();

  return {
    renderer,
    onResize,
    start() {
      animate();
    }
  };
}
