// The VEIL coin, rendered in the browser so it is always perfectly round and symmetric.
// A machined silver disc with a raised rim, the owner's logo embossed on both faces, turning slowly at a
// constant speed (one turn every PERIOD seconds) inside two thin holographic rings.
import * as THREE from '/vendor/three.module.min.js';
import { RoomEnvironment } from '/vendor/RoomEnvironment.js';

const PERIOD = 12;

function faceTextures(logo) {
  const N = 1024, c = N / 2;
  // colour: brushed silver with a darker field and a bright inner rim line
  const col = document.createElement('canvas'); col.width = col.height = N;
  const g = col.getContext('2d');
  const grad = g.createRadialGradient(c * 0.8, c * 0.7, 0, c, c, c);
  grad.addColorStop(0, '#a9abaf'); grad.addColorStop(1, '#6d7075');
  g.fillStyle = grad; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 900; i++) {            // fine concentric machining marks
    const r = Math.random() * c * 0.98;
    g.strokeStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    g.lineWidth = 1; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 6;
  g.beginPath(); g.arc(c, c, c * 0.86, 0, Math.PI * 2); g.stroke();
  // logo sized to sit inside the inner ring
  const lw = N * 0.48, lh = lw * logo.naturalHeight / logo.naturalWidth;
  const lx = c - lw / 2, ly = c - lh / 2 + N * 0.01;
  g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 10; g.shadowOffsetY = 5;
  g.globalAlpha = 1; g.drawImage(logo, lx, ly, lw, lh); g.restore();

  // bump: logo and rim raised, field flat
  const bump = document.createElement('canvas'); bump.width = bump.height = N;
  const b = bump.getContext('2d');
  b.fillStyle = '#000'; b.fillRect(0, 0, N, N);
  b.strokeStyle = '#fff'; b.lineWidth = 6; b.beginPath(); b.arc(c, c, c * 0.86, 0, Math.PI * 2); b.stroke();
  b.filter = 'blur(2px)'; b.drawImage(logo, lx, ly, lw, lh); b.filter = 'none';

  const tex = new THREE.CanvasTexture(col); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const bt = new THREE.CanvasTexture(bump);
  return [tex, bt];
}

function coinGeometry() {
  // lathe profile (radius, height): flat field, raised rim, rounded edge
  const T = 0.075, pts = [];
  const prof = [[0, T - 0.012], [0.88, T - 0.012], [0.9, T], [0.985, T], [1, T - 0.012], [1.006, 0],
    [1, -T + 0.012], [0.985, -T], [0.9, -T], [0.88, -T + 0.012], [0, -T + 0.012]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, 160);
  geo.rotateX(Math.PI / 2);                  // axis along z, faces toward the camera
  return geo;
}

export function mountCoin(host, opts = {}) {
  const logo = new Image();
  logo.src = '/img/logo-lockup.png';
  return new Promise(res => { logo.onload = () => res(build(host, logo, opts)); logo.onerror = () => res(null); });
}

function build(host, logo, opts = {}) {
  const canvas = document.createElement('canvas');
  host.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
  camera.position.set(0, 0.25, 6.2);
  camera.lookAt(0, 0, 0);

  // light from the oculus above, a cool fill, and a soft cyan kick from the rings
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(0.4, 5, 2.5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd2ff, 0.5); fill.position.set(-3, -1, 3); scene.add(fill);
  const kick = new THREE.PointLight(0xbfefff, 1.6, 6, 2); kick.position.set(1.6, 0, 0.6); scene.add(kick);

  const [tex, bump] = faceTextures(logo);
  const metal = { metalness: 1, roughness: 0.32, envMapIntensity: 1.15 };
  const coin = new THREE.Group();
  const body = new THREE.Mesh(coinGeometry(), new THREE.MeshStandardMaterial({ color: 0xb4b7bc, ...metal, roughness: 0.3 }));
  coin.add(body);
  const faceGeo = new THREE.CircleGeometry(0.88, 128);
  const faceMat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: bump, bumpScale: 5, ...metal });
  const front = new THREE.Mesh(faceGeo, faceMat); front.position.z = 0.075 - 0.011; coin.add(front);
  const back = new THREE.Mesh(faceGeo, faceMat); back.position.z = -0.075 + 0.011; back.rotation.y = Math.PI; coin.add(back);
  coin.rotation.x = -0.08;
  scene.add(coin);

  // two thin holographic rings
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x9feeff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
  const rings = (opts.rings === false ? [] : [1.32, 1.44]).map((r, i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 8, 220), ringMat);
    m.rotation.x = Math.PI / 2 + (i ? 0.16 : 0.1);
    m.rotation.z = i ? 0.05 : -0.04;
    scene.add(m); return m;
  });

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0, visible = true;
  const t0 = performance.now();
  function frame(now) {
    raf = 0;
    const t = (now - t0) / 1000;
    const fixed = /coin=(-?[\d.]+)/.exec(location.hash);   // #coin=0.4 freezes the angle (radians) for screenshots
    coin.rotation.y = fixed ? +fixed[1] : reduce ? 0.35 : (t / PERIOD) * Math.PI * 2;
    if (rings.length) { rings[0].rotation.z = -0.04 + t * 0.05; rings[1].rotation.z = 0.05 - t * 0.035; }
    renderer.render(scene, camera);
    if (visible && !document.hidden && !reduce) raf = requestAnimationFrame(frame);
  }
  const run = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; run(); }).observe(host);
  document.addEventListener('visibilitychange', run);
  run();
  requestAnimationFrame(() => host.classList.add('on'));
  return { canvas };
}
