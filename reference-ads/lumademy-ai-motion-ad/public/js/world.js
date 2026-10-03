// The Three.js layer: background, particle system, 3D showcase, tunnel and the
// extruded Lumademy logo. Everything here is driven by plain numeric props that
// the GSAP timeline tweens, plus `render(t)` for time-based motion — so seeking
// the timeline to any time reproduces the exact same frame.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';

export const W = 1920;
export const H = 1080;
const PARTICLES = 9000;

const BRAND = {
  sky: '#5DAEFF',
  blue: '#2970EC',
  royal: '#1557D1',
  deep: '#07358F',
  nightA: '#101E46',
  nightB: '#030A1D',
  white: '#FFFFFF',
  offWhite: '#EFF5FF',
};

export async function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 600);
  camera.position.set(0, 0, 22);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(buildEnvScene(), 0.02).texture;

  const key = new THREE.DirectionalLight(0xffffff, 1.3);
  key.position.set(-6, 8, 10);
  const rim = new THREE.DirectionalLight(0x70bfff, 3);
  rim.position.set(8, -2, -6);
  scene.add(key, rim, new THREE.AmbientLight(0x9cc8ff, 0.4));

  // ---------- Background (full-screen quad at the far plane) ----------
  const bgU = {
    uTime: { value: 0 },
    uNight: { value: 1 }, // 0 = brand gradient, 1 = night
    uWhite: { value: 0 }, // 0..1 blend to white
    uLines: { value: 1 },
    uGlow: { value: new THREE.Vector2(0.5, 0.72) },
    cSky: { value: new THREE.Color(BRAND.sky) },
    cBlue: { value: new THREE.Color(BRAND.blue) },
    cRoyal: { value: new THREE.Color(BRAND.royal) },
    cDeep: { value: new THREE.Color(BRAND.deep) },
    cNightA: { value: new THREE.Color(BRAND.nightA) },
    cNightB: { value: new THREE.Color(BRAND.nightB) },
    cOff: { value: new THREE.Color(BRAND.offWhite) },
  };
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: bgU,
      depthWrite: false,
      depthTest: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime, uNight, uWhite, uLines;
        uniform vec2 uGlow;
        uniform vec3 cSky, cBlue, cRoyal, cDeep, cNightA, cNightB, cOff;
        float line(float d, float w){ return smoothstep(w, 0.0, abs(d)); }
        void main(){
          vec2 uv = vUv;
          // 135deg brand gradient: top-left -> bottom-right
          float g = clamp((uv.x * 1.15 + (1.0 - uv.y) * 0.85) * 0.5, 0.0, 1.0);
          vec3 brand = mix(cSky, cBlue, smoothstep(0.0, 0.37, g));
          brand = mix(brand, cRoyal, smoothstep(0.37, 0.72, g));
          brand = mix(brand, cDeep, smoothstep(0.72, 1.0, g));

          vec2 asp = vec2(1.7778, 1.0);
          float glow = exp(-2.4 * length((uv - uGlow) * asp));
          vec3 night = mix(cNightA, cNightB, g) + cBlue * glow * 0.55;

          vec3 white = mix(vec3(1.0), cOff, g) + cSky * glow * 0.06;

          vec3 col = mix(brand + cSky * glow * 0.18, night, uNight);
          col = mix(col, white, uWhite);

          // soft flowing lines like the brand banner
          float l = 0.0;
          for (int i = 0; i < 3; i++) {
            float fi = float(i);
            float y = 0.32 + fi * 0.05 + 0.16 * sin(uv.x * 2.6 + fi * 0.9 + uTime * 0.25)
                      + 0.05 * sin(uv.x * 6.0 - uTime * 0.4 + fi);
            l += line(uv.y - y, 0.0022) * (0.10 - fi * 0.02);
          }
          col += vec3(l) * uLines * (1.0 - uWhite);

          // gentle vignette
          float v = smoothstep(1.25, 0.35, length((uv - 0.5) * asp * 0.9));
          col *= mix(0.78, 1.0, v);
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  bg.frustumCulled = false;
  bg.renderOrder = -10;
  scene.add(bg);

  // ---------- Particles ----------
  const targets = await buildParticleTargets();
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(targets.scatter, 3));
  pGeo.setAttribute('aScatter', new THREE.BufferAttribute(targets.scatter, 3));
  pGeo.setAttribute('aSphere', new THREE.BufferAttribute(targets.sphere, 3));
  pGeo.setAttribute('aAI', new THREE.BufferAttribute(targets.ai, 3));
  pGeo.setAttribute('aLogo', new THREE.BufferAttribute(targets.logo, 3));
  pGeo.setAttribute('aTunnel', new THREE.BufferAttribute(targets.tunnel, 3));
  pGeo.setAttribute('aSeed', new THREE.BufferAttribute(targets.seed, 1));
  const pU = {
    wScatter: { value: 1 },
    wSphere: { value: 0 },
    wAI: { value: 0 },
    wLogo: { value: 0 },
    wTunnel: { value: 0 },
    uTime: { value: 0 },
    uExplode: { value: 0 },
    uJitter: { value: 0.15 },
    uSize: { value: 3.2 },
    uOpacity: { value: 0 },
    uPR: { value: 1 },
    uSpin: { value: 0 },
    cA: { value: new THREE.Color('#ffffff') },
    cB: { value: new THREE.Color('#70BFFF') },
  };
  const points = new THREE.Points(
    pGeo,
    new THREE.ShaderMaterial({
      uniforms: pU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aScatter, aSphere, aAI, aLogo, aTunnel;
        attribute float aSeed;
        uniform float wScatter, wSphere, wAI, wLogo, wTunnel;
        uniform float uTime, uExplode, uJitter, uSize, uPR, uSpin;
        varying float vSeed;
        vec3 rotY(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z); }
        void main(){
          vec3 sph = rotY(aSphere, uSpin + aSeed * 0.15);
          float ws = wScatter + wSphere + wAI + wLogo + wTunnel;
          vec3 p = (aScatter * wScatter + sph * wSphere + aAI * wAI + aLogo * wLogo + aTunnel * wTunnel) / max(ws, 1e-4);
          p += vec3(sin(uTime * 0.9 + aSeed * 40.0), cos(uTime * 0.7 + aSeed * 23.0), sin(uTime * 0.6 + aSeed * 61.0)) * uJitter;
          vec3 dir = normalize(p + vec3(0.001)) ;
          p += dir * uExplode * (0.4 + aSeed * 1.2);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uSize * uPR * (0.55 + aSeed * 0.9) * (22.0 / max(-mv.z, 0.5));
          gl_Position = projectionMatrix * mv;
          vSeed = aSeed;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform vec3 cA, cB;
        varying float vSeed;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.0, d);
          a *= a;
          gl_FragColor = vec4(mix(cA, cB, step(0.55, vSeed)), a * uOpacity);
        }`,
    }),
  );
  points.frustumCulled = false;
  scene.add(points);

  // ---------- 3D showcase (chrome knot, glossy blocks, glass orb) ----------
  const showcase = new THREE.Group();
  showcase.position.set(5.6, 0, 0);
  scene.add(showcase);

  const chrome = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.08, envMapIntensity: 1.4 });
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1.7, 0.52, 320, 48, 2, 3), chrome);
  showcase.add(knot);

  const blueMat = new THREE.MeshPhysicalMaterial({ color: BRAND.blue, metalness: 0.15, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 });
  const skyMat = new THREE.MeshPhysicalMaterial({ color: BRAND.sky, metalness: 0.1, roughness: 0.25, clearcoat: 1 });
  const whiteMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.3, clearcoat: 1 });
  const boxGeo = new RoundedBoxGeometry(1, 1, 1, 5, 0.18);
  const cubes = [];
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(boxGeo, [blueMat, skyMat, whiteMat][i % 3]);
    const a = (i / 7) * Math.PI * 2;
    m.userData.home = new THREE.Vector3(Math.cos(a) * 4.1, Math.sin(a) * 3.0, Math.sin(a * 2) * 1.2);
    m.userData.spin = new THREE.Vector3(0.4 + i * 0.13, 0.7 - i * 0.05, 0.2 + i * 0.07);
    m.scale.setScalar(0);
    showcase.add(m);
    cubes.push(m);
  }

  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(1.25, 64, 64),
    new THREE.MeshPhysicalMaterial({ color: 0xd9ecff, metalness: 0, roughness: 0.02, transmission: 1, thickness: 1.6, ior: 1.45, iridescence: 0.6 }),
  );
  glass.position.set(-2.9, 2.0, 1.5);
  showcase.add(glass);

  const ico = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.0, 1)),
    new THREE.LineBasicMaterial({ color: 0xbfe2ff, transparent: true, opacity: 0.9 }),
  );
  ico.position.set(2.8, -2.2, 0.8);
  showcase.add(ico);

  // ---------- Tunnel of light rings ----------
  const tunnel = new THREE.Group();
  scene.add(tunnel);
  const ringGeo = new THREE.TorusGeometry(6.5, 0.03, 8, 200);
  const rings = [];
  for (let i = 0; i < 46; i++) {
    const m = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: i % 4 === 0 ? 0x9fd3ff : 0xffffff, transparent: true, opacity: 1 }),
    );
    m.position.z = 6 - i * 5;
    m.userData.i = i;
    tunnel.add(m);
    rings.push(m);
  }

  // ---------- Extruded 3D logo ----------
  const logo = new THREE.Group();
  scene.add(logo);
  const logoInner = await buildLogoMesh();
  logo.add(logoInner);

  // ---------- Post-processing ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.5, 0.5, 0.93);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- Tweenable state ----------
  const state = {
    camX: 0, camY: 0, camZ: 22, camRoll: 0, shake: 0,
    showcase: 0, // 0..1 master scale for showcase
    knot: 0, cubes: 0, glass: 0, ico: 0, burst: 0, showX: 5.6,
    tunnel: 0, tunnelZ: 0,
    logo: 0, logoSpin: 0, logoY: 1.25,
    pointsRotX: 0,
  };

  function resize(pixelRatio) {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(W, H, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(W, H);
    pU.uPR.value = pixelRatio;
  }

  function render(t) {
    bgU.uTime.value = t;
    pU.uTime.value = t;
    points.visible = pU.uOpacity.value > 0.001;
    points.rotation.x = state.pointsRotX;

    // camera + shake
    const sh = state.shake;
    camera.position.set(
      state.camX + sh * (Math.sin(t * 61.3) * 0.18 + Math.sin(t * 23.1) * 0.1),
      state.camY + sh * (Math.cos(t * 57.9) * 0.18 + Math.sin(t * 31.7) * 0.1),
      state.camZ,
    );
    camera.rotation.set(0, 0, state.camRoll + sh * Math.sin(t * 43.0) * 0.01);

    // showcase
    showcase.visible = state.showcase > 0.001;
    if (showcase.visible) {
      showcase.position.x = state.showX;
      showcase.scale.setScalar(state.showcase);
      const b = state.burst;
      knot.scale.setScalar(state.knot * (1 + b * 0.3));
      knot.rotation.set(t * 0.6, t * 0.9, t * 0.2);
      cubes.forEach((m, i) => {
        const k = gsap.utils.clamp(0, 1, state.cubes * 7 - i);
        const pop = k === 0 ? 0 : gsap.parseEase('back.out(2.2)')(k);
        m.scale.setScalar(pop * 0.95 * (1 - b * 0.4));
        const h = m.userData.home;
        const bob = Math.sin(t * 2.4 + i) * 0.25;
        m.position.set(h.x * (1 + b * 2.4), h.y * (1 + b * 2.4) + bob, h.z + b * 6);
        const s = m.userData.spin;
        m.rotation.set(t * s.x + i, t * s.y, t * s.z);
      });
      glass.scale.setScalar(gsap.parseEase('back.out(1.8)')(state.glass) * (1 + b * 0.5));
      glass.position.set(-2.9 - b * 6, 2.0 + Math.sin(t * 1.7) * 0.2 + b * 4, 1.5);
      ico.scale.setScalar(state.ico * (1 + b));
      ico.rotation.set(t * 0.5, t * 0.8, 0);
      ico.position.set(2.8 + b * 6, -2.2 - b * 4, 0.8);
    }

    // tunnel
    tunnel.visible = state.tunnel > 0.001;
    if (tunnel.visible) {
      rings.forEach((m) => {
        const i = m.userData.i;
        m.material.opacity = state.tunnel;
        m.position.x = Math.sin(i * 0.35 + t * 0.8) * 0.9;
        m.position.y = Math.cos(i * 0.28 + t * 0.6) * 0.7;
        m.rotation.z = i * 0.2 + t * 0.3;
        m.scale.setScalar(1 + Math.sin(i * 0.5 + t * 2.0) * 0.06);
      });
    }

    // logo
    logo.visible = state.logo > 0.001;
    if (logo.visible) {
      logo.position.y = state.logoY + Math.sin(t * 1.4) * 0.06;
      logo.scale.setScalar(state.logo);
      logo.rotation.set(Math.sin(t * 0.9) * 0.05, state.logoSpin + Math.sin(t * 0.7) * 0.12, 0);
    }

    composer.render();
  }

  return { renderer, scene, camera, composer, bloom, logo, state, bg: bgU, particles: pU, render, resize };
}

// ---------------------------------------------------------------------------

async function buildParticleTargets() {
  const N = PARTICLES;
  const scatter = new Float32Array(N * 3);
  const sphere = new Float32Array(N * 3);
  const tunnel = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  const rnd = mulberry32(7);

  for (let i = 0; i < N; i++) {
    seed[i] = rnd();
    scatter.set([(rnd() - 0.5) * 46, (rnd() - 0.5) * 28, (rnd() - 0.5) * 30 - 4], i * 3);

    // fibonacci sphere with a little thickness
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const phi = i * 2.399963229728653;
    const R = 4.6 + (rnd() - 0.5) * 0.35;
    sphere.set([Math.cos(phi) * r * R, y * R, Math.sin(phi) * r * R], i * 3);

    // long cylinder for the tunnel fly-through
    const a = rnd() * Math.PI * 2;
    const tr = 4 + rnd() * 6;
    tunnel.set([Math.cos(a) * tr, Math.sin(a) * tr, 10 - rnd() * 240], i * 3);
  }

  const ai = sampleCanvas(N, rnd, 15, (ctx, w, h) => {
    ctx.font = '900 420px Inter';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('AI', w / 2, h / 2 + 20);
  });

  const svgText = await (await fetch('assets/Lumademy_Icon_White.svg')).text();
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
  await img.decode();
  const logo = sampleCanvas(N, rnd, 13.2, (ctx, w, h) => {
    const s = h * 0.95;
    ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s);
  }, 0.0, 1.25);

  return { scatter, sphere, ai, logo, tunnel, seed };
}

// Draws something on a canvas, then places N points on its filled pixels.
function sampleCanvas(N, rnd, worldWidth, draw, depth = 0.6, yOffset = 0) {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  draw(ctx, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const filled = [];
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (data[(y * w + x) * 4 + 3] > 140) filled.push(x, y);
    }
  }
  const out = new Float32Array(N * 3);
  const scale = worldWidth / w;
  const count = filled.length / 2;
  for (let i = 0; i < N; i++) {
    const k = Math.floor(rnd() * count) * 2;
    const x = filled[k] + (rnd() - 0.5) * 2;
    const y = filled[k + 1] + (rnd() - 0.5) * 2;
    out.set([(x - w / 2) * scale, -(y - h / 2) * scale + yOffset, (rnd() - 0.5) * depth], i * 3);
  }
  return out;
}

async function buildLogoMesh() {
  const svgText = await (await fetch('assets/Lumademy_Icon_White.svg')).text();
  const data = new SVGLoader().parse(svgText);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xf4f8ff,
    roughness: 0.3,
    metalness: 0.0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.15,
    envMapIntensity: 1.0,
  });

  const group = new THREE.Group();
  for (const path of data.paths) {
    for (const shape of path.toShapes(true)) {
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: 34,
        bevelEnabled: true,
        bevelThickness: 6,
        bevelSize: 3.2,
        bevelSegments: 6,
        curveSegments: 6,
      });
      group.add(new THREE.Mesh(geo, mat));
    }
  }
  // Centre the raw SVG-space geometry, then flip y (SVG is y-down) and
  // normalise to ~4.4 world units tall.
  const box = new THREE.Box3();
  group.children.forEach((m) => {
    m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox);
  });
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  group.children.forEach((m) => m.geometry.translate(-center.x, -center.y, -center.z));
  const k = 4.4 / size.y;
  group.scale.set(k, -k, k);
  return group;
}

// A small studio for reflections: dark floor, bright sky, a few strip lights.
// (RoomEnvironment's HDR values overflow here and bloom turns them into blobs.)
function buildEnvScene() {
  const env = new THREE.Scene();
  const geo = new THREE.SphereGeometry(20, 48, 24);
  const cols = [];
  const top = new THREE.Color('#dce9ff');
  const bottom = new THREE.Color('#0a1430');
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = THREE.MathUtils.smoothstep(pos.getY(i) / 20, -0.3, 0.7);
    const c = bottom.clone().lerp(top, k);
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const strip = (color, intensity, x, y, z, w, h) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  strip('#ffffff', 3, 0, 9, 8, 14, 3);
  strip('#ffffff', 2.2, -12, 2, 4, 2, 12);
  strip('#9fd3ff', 2.2, 12, 0, 2, 2, 12);
  strip('#2970EC', 1.5, 0, -2, -14, 18, 6);
  return env;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
