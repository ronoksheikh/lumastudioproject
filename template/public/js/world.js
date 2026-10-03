// The Three.js layer: brand background, a morphing particle system (scatter, globe, ring,
// logo, text) and the extruded 3D logo. Everything is driven by numeric props that the GSAP
// timeline tweens, plus `render(t)` for time-based motion — so seeking reproduces the exact frame.
//
// createWorld(canvas, { W, H, brand, features })
//   features: { particles: true, logo3d: true, bloom: true }   (turn off what a video doesn't use)

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PARTICLES = 9000;
const REF_ASPECT = 16 / 9;

export async function createWorld(canvas, { W = 1920, H = 1080, brand, features = {} } = {}) {
  const feat = { particles: true, logo3d: true, bloom: true, ...features };
  const C = brand.colors;
  const aspect = W / H;
  // portrait stages: shrink 3D content so it stays inside the narrower frame
  const fit = Math.min(1, aspect / REF_ASPECT * 1.25);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, aspect, 0.1, 600);
  camera.position.set(0, 0, 22);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(buildEnvScene(), 0.02).texture;
  const key = new THREE.DirectionalLight(0xffffff, 1.3);
  key.position.set(-6, 8, 10);
  const rim = new THREE.DirectionalLight(0x70bfff, 2.5);
  rim.position.set(8, -2, -6);
  scene.add(key, rim, new THREE.AmbientLight(0x9cc8ff, 0.4));

  // ---------- Background ----------
  const bgU = {
    uTime: { value: 0 },
    uNight: { value: 0 }, // 0 = Lumademy blue gradient, 1 = deep night (use sparingly)
    uWhite: { value: 0 }, // 1 = white stage
    uWarm: { value: 0 }, // brighter blue-white bloom for big moments
    uGlow: { value: new THREE.Vector2(0.5, 0.62) },
    uAsp: { value: new THREE.Vector2(aspect, 1.0) },
    cSky: { value: new THREE.Color(C.sky) },
    cBlue: { value: new THREE.Color(C.blue) },
    cRoyal: { value: new THREE.Color(C.royal) },
    cDeep: { value: new THREE.Color(C.deep) },
    cNightA: { value: new THREE.Color(C.nightA) },
    cNightB: { value: new THREE.Color(C.nightB) },
    cOff: { value: new THREE.Color(C.off) },
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
        uniform float uTime, uNight, uWhite, uWarm;
        uniform vec2 uGlow, uAsp;
        uniform vec3 cSky, cBlue, cRoyal, cDeep, cNightA, cNightB, cOff;
        float line(float d, float w){ return smoothstep(w, 0.0, abs(d)); }
        void main(){
          vec2 uv = vUv;
          vec2 asp = uAsp;
          float g = clamp((uv.x * 1.15 + (1.0 - uv.y) * 0.85) * 0.5, 0.0, 1.0);
          vec3 brand = mix(cSky, cBlue, smoothstep(0.0, 0.37, g));
          brand = mix(brand, cRoyal, smoothstep(0.37, 0.72, g));
          brand = mix(brand, cDeep, smoothstep(0.72, 1.0, g));
          float glow = exp(-2.4 * length((uv - uGlow) * asp));
          vec3 night = mix(cNightA, cNightB, g) + cBlue * glow * 0.55;
          vec3 white = mix(vec3(1.0), cOff, g) + cSky * glow * 0.06;
          vec3 col = mix(brand + cSky * glow * 0.18, night, uNight);
          col = mix(col, white, uWhite);
          col += vec3(0.08, 0.12, 0.2) * glow * uWarm * (1.0 - uWhite); // brighter blue-white bloom, no orange cast

          float l = 0.0;
          for (int i = 0; i < 3; i++) {
            float fi = float(i);
            float y = 0.32 + fi * 0.05 + 0.16 * sin(uv.x * 2.6 + fi * 0.9 + uTime * 0.25)
                      + 0.05 * sin(uv.x * 6.0 - uTime * 0.4 + fi);
            l += line(uv.y - y, 0.0022) * (0.10 - fi * 0.02);
          }
          col += vec3(l) * (1.0 - uWhite);
          float v = smoothstep(1.25, 0.35, length((uv - 0.5) * asp * 0.9));
          col *= mix(0.78, 1.0, v);
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  bg.frustumCulled = false;
  bg.renderOrder = -10;
  scene.add(bg);

  // ---------- Particles + 3D logo share the brand icon ----------
  const needIcon = feat.particles || feat.logo3d;
  const lumaSvg = needIcon ? await (await fetch(brand.logo.icon)).text() : '';

  const rnd = mulberry32(5);
  const pU = {
    wScatter: { value: 1 }, wSphere: { value: 0 }, wLogo: { value: 0 }, wRing: { value: 0 }, wText: { value: 0 },
    uTime: { value: 0 }, uExplode: { value: 0 }, uJitter: { value: 0.15 }, uSize: { value: 3.2 },
    uOpacity: { value: 0 }, uPR: { value: 1 }, uSpin: { value: 0 },
    cA: { value: new THREE.Color('#ffffff') },
    cB: { value: new THREE.Color('#70BFFF') },
  };
  let points = null;
  let pGeo = null;
  let setTextTarget = async () => {};
  if (feat.particles) {
    const T = await buildParticleTargets(lumaSvg, rnd, { aspect, fit });
    pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(T.scatter, 3));
    for (const [name, arr] of Object.entries({ aScatter: T.scatter, aSphere: T.sphere, aLogo: T.logo, aRing: T.ring, aText: T.logo.slice() })) {
      pGeo.setAttribute(name, new THREE.BufferAttribute(arr, 3));
    }
    pGeo.setAttribute('aSeed', new THREE.BufferAttribute(T.seed, 1));
    points = new THREE.Points(
      pGeo,
      new THREE.ShaderMaterial({
        uniforms: pU,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec3 aScatter, aSphere, aLogo, aRing, aText;
          attribute float aSeed;
          uniform float wScatter, wSphere, wLogo, wRing, wText;
          uniform float uTime, uExplode, uJitter, uSize, uPR, uSpin;
          varying float vSeed;
          vec3 rotY(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z); }
          vec3 rotZ(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(c*p.x - s*p.y, s*p.x + c*p.y, p.z); }
          void main(){
            vec3 sph = rotY(aSphere, uSpin);
            vec3 ring = rotZ(aRing, -uSpin * 1.5);
            float ws = wScatter + wSphere + wLogo + wRing + wText;
            vec3 p = (aScatter * wScatter + sph * wSphere + aLogo * wLogo + ring * wRing + aText * wText) / max(ws, 1e-4);
            p += vec3(sin(uTime * 0.9 + aSeed * 40.0), cos(uTime * 0.7 + aSeed * 23.0), sin(uTime * 0.6 + aSeed * 61.0)) * uJitter;
            p += normalize(p + vec3(0.001)) * uExplode * (0.4 + aSeed * 1.2);
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
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            a *= a;
            vec3 c = mix(cA, cB, step(0.55, vSeed));
            gl_FragColor = vec4(c, a * uOpacity);
          }`,
      }),
    );
    points.frustumCulled = false;
    scene.add(points);

    /** Re-samples the "text" particle target. Call at build time (before the first render). */
    setTextTarget = async (text, { font = '900 420px Inter', worldWidth = 15 * fit, yOffset = 0 } = {}) => {
      await document.fonts.load(font);
      const arr = sampleCanvas(PARTICLES, mulberry32(11), worldWidth, (ctx, w, h) => {
        ctx.font = font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, w / 2, h / 2 + 20);
      }, 0.6, yOffset);
      pGeo.setAttribute('aText', new THREE.BufferAttribute(arr, 3));
    };
  }

  // ---------- 3D logo ----------
  let logo = null;
  if (feat.logo3d) {
    logo = new THREE.Mesh(
      extrudeSvg(lumaSvg, { depth: 34, bevelThickness: 6, bevelSize: 3.2, bevelSegments: 6, curveSegments: 6 }, 4.4),
      new THREE.MeshPhysicalMaterial({ color: 0xf4f8ff, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15, envMapIntensity: 1 }),
    );
    scene.add(logo);
  }

  // ---------- Post ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.5, 0.5, 0.93);
  if (feat.bloom) composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- Tweenable state ----------
  const state = {
    camX: 0, camY: 0, camZ: 22, camRoll: 0, shake: 0,
    logo: 0, logoSpin: 0, logoX: 0, logoY: 1.25,
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
    if (points) points.visible = pU.uOpacity.value > 0.001;

    const sh = state.shake;
    camera.position.set(
      state.camX + sh * (Math.sin(t * 61.3) * 0.18 + Math.sin(t * 23.1) * 0.1),
      state.camY + sh * (Math.cos(t * 57.9) * 0.18 + Math.sin(t * 31.7) * 0.1),
      state.camZ,
    );
    camera.rotation.set(0, 0, state.camRoll + sh * Math.sin(t * 43.0) * 0.01);

    if (logo) {
      logo.visible = state.logo > 0.001;
      if (logo.visible) {
        logo.position.set(state.logoX, state.logoY + Math.sin(t * 1.4) * 0.06, 0);
        logo.scale.setScalar(state.logo * fit);
        logo.rotation.set(Math.sin(t * 0.9) * 0.05, state.logoSpin + Math.sin(t * 0.7) * 0.12, 0);
      }
    }

    composer.render();
  }

  return { renderer, scene, camera, composer, bloom, state, bg: bgU, particles: pU, render, resize, setTextTarget, size: { W, H }, fit };
}

// ---------------------------------------------------------------------------

// Parses an SVG, extrudes all of its paths, centres the result and scales it to `height`.
function extrudeSvg(svgText, opts, height) {
  const data = new SVGLoader().parse(svgText);
  const geos = [];
  for (const path of data.paths) {
    for (const shape of path.toShapes(true)) {
      geos.push(new THREE.ExtrudeGeometry(shape, { bevelEnabled: true, ...opts }));
    }
  }
  const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos);
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  const c = box.getCenter(new THREE.Vector3());
  const k = height / (box.max.y - box.min.y);
  geo.translate(-c.x, -c.y, -c.z);
  geo.scale(k, k, k);
  geo.rotateX(Math.PI); // SVG is y-down; a rotation (not a mirror) keeps faces outward
  return geo;
}

async function buildParticleTargets(logoSvg, rnd, { aspect, fit }) {
  const N = PARTICLES;
  const scatter = new Float32Array(N * 3);
  const sphere = new Float32Array(N * 3);
  const ring = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  // scatter box follows the stage aspect (identical to the original at 16:9)
  const sx = Math.min(1, aspect / REF_ASPECT);
  const sy = Math.max(1, REF_ASPECT / aspect);

  for (let i = 0; i < N; i++) {
    seed[i] = rnd();
    scatter.set([(rnd() - 0.5) * 46 * sx, (rnd() - 0.5) * 28 * sy, (rnd() - 0.5) * 30 - 4], i * 3);
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const phi = i * 2.399963229728653;
    const R = (4.6 + (rnd() - 0.5) * 0.35) * fit;
    sphere.set([Math.cos(phi) * r * R, y * R, Math.sin(phi) * r * R], i * 3);
    const a = rnd() * Math.PI * 2;
    const rr = (4.3 + (rnd() - 0.5) * 0.5 * (rnd() < 0.85 ? 0.4 : 3)) * fit;
    ring.set([Math.cos(a) * rr, Math.sin(a) * rr, (rnd() - 0.5) * 0.4], i * 3);
  }

  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(logoSvg);
  await img.decode();
  // sized and placed to sit exactly behind the 3D logo (4.4 units tall at y = logoY)
  const logo = sampleCanvas(N, rnd, 13.2 * 0.62 * fit, (ctx, w, h) => {
    const s = h * 0.95;
    ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s);
  }, 0.0, 2.3);

  return { scatter, sphere, logo, ring, seed };
}

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

// A small studio for reflections: dark floor, bright sky, a few strip lights.
// (Not three's RoomEnvironment: with bloom it turns lit materials into a white blob.)
function buildEnvScene() {
  const env = new THREE.Scene();
  const geo = new THREE.SphereGeometry(20, 48, 24);
  const cols = [];
  const top = new THREE.Color('#dce9ff');
  const bottom = new THREE.Color('#0a1430');
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const c = bottom.clone().lerp(top, THREE.MathUtils.smoothstep(pos.getY(i) / 20, -0.3, 0.7));
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
