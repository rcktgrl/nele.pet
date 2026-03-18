export function createRenderPipeline({
  THREE,
  canvas,
  scene,
  clock,
  cameras,
  resizeOverlays,
  frameUpdate,
  getActiveCamera
}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  function onResize() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    renderer.setSize(W, H);
    cameras.forEach(c => {
      c.aspect = W / H;
      c.updateProjectionMatrix();
    });
    if (resizeOverlays) resizeOverlays();
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    frameUpdate(dt);
    renderer.render(scene, getActiveCamera());
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
