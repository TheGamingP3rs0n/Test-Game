// Post-processing pipeline:
//   RenderPass (MSAA, HDR half-float)
//   → VolumetricShaftPass  (raymarched sunbeams through the windows, depth-aware, half-res)
//   → GTAOPass             (ground-truth ambient occlusion)
//   → UnrealBloomPass      (soft glow on lights, screens, sunlit windows)
//   → OutputPass           (ACES tone mapping + sRGB)
//   → GradePass            (warm grade, vignette, film grain, faint chromatic aberration, alarm tint)
// Quality presets trade these off so it runs on modest PCs too.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const QUALITY = {
  low: { label: 'Low', pixelRatio: 0.85, msaa: 0, shadows: false, shadowSize: 1024, ao: false, bloom: false, shafts: false, reflections: false, grain: true },
  medium: { label: 'Medium', pixelRatio: 1, msaa: 4, shadows: true, shadowSize: 2048, ao: false, bloom: true, shafts: true, reflections: false, grain: true },
  high: { label: 'High', pixelRatio: 1.25, msaa: 4, shadows: true, shadowSize: 2048, ao: true, bloom: true, shafts: true, reflections: true, grain: true },
  ultra: { label: 'Ultra', pixelRatio: 2, msaa: 4, shadows: true, shadowSize: 4096, ao: true, bloom: true, shafts: true, reflections: true, grain: true },
};

// ---------------------------------------------------------------------------
// Volumetric sun shafts. Each window beam is a parallelepiped (window rectangle
// extruded along the sun direction). Per pixel we intersect the view ray with
// every beam analytically and integrate a density profile up to the scene depth.
// ---------------------------------------------------------------------------
const MAX_BEAMS = 12;
const ShaftShader = {
  uniforms: {
    tDepth: { value: null },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uBeams: { value: Array.from({ length: MAX_BEAMS }, () => new THREE.Matrix4()) },
    uBeamCount: { value: 0 },
    uColor: { value: new THREE.Color(1, 0.78, 0.5) },
    uStrength: { value: 0.075 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    #define MAX_BEAMS ${MAX_BEAMS}
    uniform sampler2D tDepth;
    uniform mat4 uInvProj;
    uniform mat4 uCamWorld;
    uniform vec3 uCamPos;
    uniform mat4 uBeams[MAX_BEAMS];
    uniform int uBeamCount;
    uniform vec3 uColor;
    uniform float uStrength;
    uniform float uTime;
    varying vec2 vUv;

    float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float noise(vec3 x) {
      vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
    }

    void main() {
      float depth = texture2D(tDepth, vUv).x;
      vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec4 view = uInvProj * clip; view /= view.w;
      vec3 world = (uCamWorld * view).xyz;
      vec3 rd = world - uCamPos;
      float sceneDist = length(rd);
      rd /= sceneDist;
      float jitter = hash(vec3(gl_FragCoord.xy, uTime * 60.0));
      float total = 0.0;
      for (int b = 0; b < MAX_BEAMS; b++) {
        if (b >= uBeamCount) break;
        mat4 inv = uBeams[b];
        vec3 ro = (inv * vec4(uCamPos, 1.0)).xyz;
        vec3 rl = (inv * vec4(rd, 0.0)).xyz;
        vec3 invD = 1.0 / rl;
        vec3 t0 = (vec3(0.0) - ro) * invD;
        vec3 t1 = (vec3(1.0) - ro) * invD;
        vec3 tmin = min(t0, t1); vec3 tmax = max(t0, t1);
        float sIn = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
        float sOut = min(min(tmax.x, tmax.y), min(tmax.z, sceneDist));
        if (sOut <= sIn) continue;
        float seg = sOut - sIn;
        float acc = 0.0;
        const int STEPS = 7;
        for (int i = 0; i < STEPS; i++) {
          float s = sIn + seg * (float(i) + jitter) / float(STEPS);
          vec3 p = ro + rl * s;
          // soft edges across the window, fade along the beam
          float edge = smoothstep(0.0, 0.07, p.x) * smoothstep(1.0, 0.93, p.x) * smoothstep(0.0, 0.07, p.y) * smoothstep(1.0, 0.93, p.y);
          float along = pow(1.0 - p.z, 2.2) * smoothstep(0.0, 0.04, p.z);
          vec3 wp = uCamPos + rd * s;
          float n = 0.35 + 1.3 * noise(wp * 2.2 + vec3(0.0, uTime * 0.05, uTime * 0.11));
          // half-lowered blinds: slats stripe the top half of every beam
          float slats = mix(1.0, smoothstep(0.25, 0.6, abs(fract(p.y * 9.0) - 0.5) * 2.0), step(0.52, p.y));
          acc += edge * along * n * slats;
        }
        total += acc * seg / float(STEPS);
      }
      gl_FragColor = vec4(uColor * total * uStrength, 1.0);
    }
  `,
};

const AddShader = {
  uniforms: { tShafts: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tShafts; varying vec2 vUv;
    void main() { gl_FragColor = vec4(texture2D(tShafts, vUv).rgb, 1.0); }
  `,
};

class VolumetricShaftPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.needsSwap = false;
    this.material = new THREE.ShaderMaterial({ ...ShaftShader, uniforms: THREE.UniformsUtils.clone(ShaftShader.uniforms), depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.material);
    this.addMaterial = new THREE.ShaderMaterial({ ...AddShader, uniforms: THREE.UniformsUtils.clone(AddShader.uniforms), blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false });
    this.addQuad = new FullScreenQuad(this.addMaterial);
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.beams = [];
    this.strength = 0.075;
  }

  setBeams(beams) {
    // beams: array of THREE.Matrix4 (beam local unit cube → world). Store inverses.
    this.beams = beams.slice(0, MAX_BEAMS).map((m) => m.clone().invert());
    const u = this.material.uniforms;
    u.uBeamCount.value = this.beams.length;
    this.beams.forEach((m, i) => u.uBeams.value[i].copy(m));
  }

  setSize(w, h) {
    this.rt.setSize(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)));
  }

  render(renderer, writeBuffer, readBuffer, dt) {
    if (!this.beams.length || !readBuffer.depthTexture) return;
    const u = this.material.uniforms;
    u.tDepth.value = readBuffer.depthTexture;
    u.uInvProj.value.copy(this.camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(this.camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(this.camera.matrixWorld);
    u.uTime.value += dt || 0.016;
    u.uStrength.value = this.strength;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    this.quad.render(renderer);
    this.addMaterial.uniforms.tShafts.value = this.rt.texture;
    renderer.setRenderTarget(readBuffer);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.addQuad.render(renderer);
    renderer.autoClear = autoClear;
  }
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.62 },
    uGrain: { value: 0.032 },
    uWarm: { value: 0.022 },
    uSat: { value: 1.34 },
    uContrast: { value: 1.22 },
    uLift: { value: -0.03 },
    uCA: { value: 0.0026 },
    uTint: { value: new THREE.Color(1, 0.2, 0.2) },
    uTintAmt: { value: 0 },
    uDesat: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uWarm, uSat, uContrast, uLift, uCA, uTintAmt, uDesat;
    uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 dir = vUv - 0.5;
      float d = length(dir);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + dir * uCA * d).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - dir * uCA * d).b;
      // contrast around a slightly-below-mid pivot = darker, punchier midtones
      col = (col - 0.46) * uContrast + 0.46 + uLift;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      // saturate more in shadows/mids than in highlights so bright screens don't blow out
      float satAmt = uSat * (1.0 - uDesat) * (1.0 - 0.25 * smoothstep(0.6, 1.0, l));
      col = mix(vec3(l), col, satAmt);
      col += vec3(uWarm, uWarm * 0.45, -uWarm * 0.7) * smoothstep(0.35, 1.0, l);
      col += vec3(-0.012, 0.004, 0.02) * (1.0 - smoothstep(0.0, 0.3, l));
      col = mix(col, col * uTint * 1.4 + uTint * 0.08, uTintAmt);
      col *= 1.0 - uVignette * smoothstep(0.3, 0.95, d * 1.15);
      col += (hash(vUv * vec2(1931.0, 1087.0) + fract(uTime)) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

export class RenderPipeline {
  constructor(renderer, scene, camera, quality = QUALITY.high) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.tintTarget = 0;
    this.build();
  }

  build() {
    const q = this.quality;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer?.dispose?.();
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa });
    rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
    rt.depthTexture.type = THREE.UnsignedIntType;
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.shafts = new VolumetricShaftPass(this.camera);
    this.shafts.enabled = q.shafts;
    if (this.beams) this.shafts.setBeams(this.beams);
    this.composer.addPass(this.shafts);

    this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.9;
    this.gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12, distanceFallOff: 1.0 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.gtao.enabled = q.ao;
    this.composer.addPass(this.gtao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.35, 1.35);
    this.bloom.enabled = q.bloom;
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.uGrain.value = q.grain ? 0.028 : 0;
    this.composer.addPass(this.grade);
    this.setSize(window.innerWidth, window.innerHeight);
  }

  setQuality(name) {
    this.quality = QUALITY[name] || QUALITY.high;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    this.build();
    this.scene.traverse((o) => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
    });
  }

  setBeams(matrices) {
    this.beams = matrices;
    this.shafts?.setBeams(matrices);
  }

  setSize(w, h) {
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h); // also resizes every pass (AO, bloom, shafts)
  }

  /** alarm tint: color + 0..1 amount (lerped smoothly) */
  setTint(color, amount) {
    if (color) this.grade.uniforms.uTint.value.set(color);
    this.tintTarget = amount;
  }

  setDesaturate(v) {
    this.grade.uniforms.uDesat.value = v;
  }

  render(dt) {
    const g = this.grade.uniforms;
    g.uTime.value += dt;
    g.uTintAmt.value += (this.tintTarget - g.uTintAmt.value) * Math.min(1, dt * 4);
    this.composer.render(dt);
  }
}
