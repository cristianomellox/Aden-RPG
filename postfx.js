
// porque os módulos de postprocessing do Three.js importam 'three' internamente
// como specifier nu — sem o import map, o navegador não consegue resolver isso.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ── CONFIGURAÇÃO (ajuste os números à vontade) ──────────────────────────
export const POSTFX_CONFIG = {
    // Bloom (UnrealBloomPass oficial do Three.js — o nome não é coincidência,
    // foi desenhado com base no bloom da Unreal Engine).
    bloom: {
        enabled: true,
        strength: 0.65,   // intensidade do brilho
        radius: 0.55,     // o quanto o brilho "espalha"
        threshold: 0.72,  // só pixels mais claros que isso brilham (0-1)
    },
    // "Iluminação ambiente global" (tint de cor) + contraste/saturação + vinheta.
    colorGrade: {
        enabled: true,
        tint: [1.0, 0.965, 0.9],  // cor da luz ambiente (levemente quente/dourada)
        tintStrength: 0.16,        // 0 = neutro, 1 = tint total
        contrast: 1.04,
        saturation: 1.2,
        vignetteStrength: 0.22,
    },
    // Cintilação automática (sparkle) em áreas azuis/brilhantes já renderizadas —
    // detecta água, cristais, magia etc. pela COR do pixel final, sem precisar
    // de máscara manual por mapa. Funciona em qualquer cenário com esse tom.
    shimmer: {
        enabled: true,
        threshold: 0.15,   // quanto o azul precisa "dominar" pra contar como água/cristal
        brightMin: 0.22,   // brilho mínimo do pixel pra poder cintilar
        intensity: 0.5,    // força do brilho do sparkle
        density: 420.0,    // quantos pontos de sparkle "cabem" na tela (maior = mais pontos, menores)
        speed: 0.7,        // velocidade da cintilação ao longo do tempo
        color: [0.65, 0.88, 1.0],
    },
    // Lens flare / brilho anamórfico em espaço de tela — reage automaticamente
    // a QUALQUER pixel muito brilhante do frame já renderizado (tochas, cristais,
    // céu, círculos mágicos...), sem precisar saber onde as luzes estão no mapa.
    lensFlare: {
        enabled: true,
        threshold: 0.8,     // só pixels bem claros geram flare
        intensity: 0.40,    // força geral do efeito
        ghosts: 3,          // nº de "fantasmas" (reflexos) ao longo da linha até o centro
        streak: 0.5,        // força da estria horizontal anamórfica
        chromaticAberration: 0.006,
    },
  
    // Reflete o mesmo grading na camada 2D (mobs/HUD sobre o mapa) pra tudo
    // parecer uma cena só, e reforça sombra de contato (fake AO) + vinheta.
    domLayer: {
        enabled: true,
    },
};

// ── Shaders customizados ────────────────────────────────────────────────
const ColorGradeShader = {
    name: 'ColorGradeShader',
    uniforms: {
        tDiffuse: { value: null },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uTintStrength: { value: 0.0 },
        uContrast: { value: 1.0 },
        uSaturation: { value: 1.0 },
        uVignetteStrength: { value: 0.0 },
        // Shimmer (cintilação automática em água/cristais/áreas azuis brilhantes)
        uTime: { value: 0.0 },
        uShimmerEnabled: { value: 0.0 },
        uShimmerThreshold: { value: 0.15 },
        uShimmerBrightMin: { value: 0.22 },
        uShimmerIntensity: { value: 0.5 },
        uShimmerDensity: { value: 420.0 },
        uShimmerSpeed: { value: 0.7 },
        uShimmerColor: { value: new THREE.Vector3(0.65, 0.88, 1.0) },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform vec3 uTint;
        uniform float uTintStrength;
        uniform float uContrast;
        uniform float uSaturation;
        uniform float uVignetteStrength;
        uniform float uTime;
        uniform float uShimmerEnabled;
        uniform float uShimmerThreshold;
        uniform float uShimmerBrightMin;
        uniform float uShimmerIntensity;
        uniform float uShimmerDensity;
        uniform float uShimmerSpeed;
        uniform vec3 uShimmerColor;
        varying vec2 vUv;

        // Hash 2D simples (sem textura de ruído — barato e determinístico).
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
        }

        void main() {
            vec4 color = texture2D(tDiffuse, vUv);

            // "Luz ambiente global": tint multiplicativo suave sobre a cena inteira.
            color.rgb = mix(color.rgb, color.rgb * uTint, uTintStrength);

            // Contraste em torno do ponto médio.
            color.rgb = (color.rgb - 0.5) * uContrast + 0.5;

            // Saturação via mistura com a luminância (percepção humana).
            float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
            color.rgb = mix(vec3(luma), color.rgb, uSaturation);

            // ── Cintilação automática (água/cristais/magia) ──────────────────
            // Detecta pela cor do pixel JÁ renderizado: azul dominando + brilho
            // suficiente = provável água, cristal ou efeito mágico. Não depende
            // de nenhuma máscara pré-desenhada, então funciona em qualquer mapa.
            if (uShimmerEnabled > 0.5) {
                float blueDominance = color.b - max(color.r, color.g);
                float brightness = luma;
                float waterish = smoothstep(0.0, uShimmerThreshold, blueDominance)
                               * smoothstep(uShimmerBrightMin, uShimmerBrightMin + 0.35, brightness);
                if (waterish > 0.0) {
                    vec2 cell = floor(vUv * uShimmerDensity);
                    float n = hash(cell);
                    float twinkle = step(0.975, fract(n + uTime * uShimmerSpeed));
                    color.rgb += uShimmerColor * twinkle * waterish * uShimmerIntensity;
                }
            }

            // Vinheta suave nas bordas (reforça profundidade / "ambient occlusion" de tela).
            float dist = length(vUv - 0.5) * 1.4142;
            float vig = smoothstep(1.0, 0.35, dist);
            color.rgb *= mix(1.0, vig, uVignetteStrength);

            gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
        }`,
};

// Lens flare / brilho anamórfico em espaço de tela: gera "fantasmas" (cópias
// espelhadas em direção ao centro da tela) e uma estria horizontal a partir
// de QUALQUER pixel muito brilhante do frame — reage automaticamente a
// cristais, tochas, céu, magia etc., sem precisar saber onde estão no mapa.
const LensFlareShader = {
    name: 'LensFlareShader',
    uniforms: {
        tDiffuse: { value: null },
        uThreshold: { value: 0.8 },
        uIntensity: { value: 0.55 },
        uGhosts: { value: 5 },
        uStreak: { value: 0.7 },
        uChromaticAberration: { value: 0.006 },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float uThreshold;
        uniform float uIntensity;
        uniform int uGhosts;
        uniform float uStreak;
        uniform float uChromaticAberration;
        varying vec2 vUv;

        float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

        vec3 brightPass(vec2 uv) {
            vec3 c = texture2D(tDiffuse, uv).rgb;
            float w = smoothstep(uThreshold, uThreshold + 0.2, luma(c));
            return c * w;
        }

        void main() {
            vec3 base = texture2D(tDiffuse, vUv).rgb;
            vec2 center = vec2(0.5);
            vec2 toCenter = center - vUv;

            // Fantasmas: reamostra o bright-pass espelhado em várias escalas
            // ao longo da linha pixel→centro→além, com leve aberração cromática.
            vec3 flare = vec3(0.0);
            const int MAX_GHOSTS = 6;
            for (int i = 0; i < MAX_GHOSTS; i++) {
                if (i >= uGhosts) break;
                float scale = -0.6 + float(i) * 0.42;
                vec2 guv = vUv + toCenter * (1.0 - scale);
                vec2 aberr = vec2(uChromaticAberration * float(i + 1), 0.0);
                vec3 g;
                g.r = brightPass(clamp(guv + aberr, 0.0, 1.0)).r;
                g.g = brightPass(clamp(guv, 0.0, 1.0)).g;
                g.b = brightPass(clamp(guv - aberr, 0.0, 1.0)).b;
                flare += g / float(MAX_GHOSTS);
            }

            // Estria horizontal anamórfica (assinatura visual clássica de lens flare).
            vec3 streak = vec3(0.0);
            const int STREAK_SAMPLES = 10;
            float streakWidth = 0.045;
            for (int i = 0; i < STREAK_SAMPLES; i++) {
                float t = (float(i) / float(STREAK_SAMPLES - 1) - 0.5) * 2.0;
                vec2 suv = clamp(vUv + vec2(t * streakWidth, 0.0), 0.0, 1.0);
                float w = 1.0 - abs(t) * 0.5;
                streak += brightPass(suv) * w;
            }
            streak /= float(STREAK_SAMPLES);

            vec3 result = base + (flare + streak * uStreak) * uIntensity;
            gl_FragColor = vec4(clamp(result, 0.0, 4.0), 1.0);
        }`,
};

const MotionBlurShader = {
    name: 'MotionBlurShader',
    uniforms: {
        tDiffuse: { value: null },
        uDirection: { value: new THREE.Vector2(1, 0) },
        uAmount: { value: 0.0 },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform vec2 uDirection;
        uniform float uAmount;
        varying vec2 vUv;
        void main() {
            if (uAmount <= 0.0001) {
                gl_FragColor = texture2D(tDiffuse, vUv);
                return;
            }
            const int SAMPLES = 9;
            vec4 result = vec4(0.0);
            float total = 0.0;
            for (int i = 0; i < SAMPLES; i++) {
                float t = (float(i) / float(SAMPLES - 1)) - 0.5;
                vec2 offset = uDirection * uAmount * t;
                float w = 1.0 - abs(t) * 0.6;
                result += texture2D(tDiffuse, clamp(vUv + offset, 0.0, 1.0)) * w;
                total += w;
            }
            gl_FragColor = result / total;
        }`,
};

// ── Poeira mágica flutuante (partículas 100% procedurais, sem textura externa) ──
// O ponto é desenhado por um círculo suave calculado no próprio fragment shader
// (via gl_PointCoord), então não precisa de nenhuma imagem — zero risco de CORS
// ou de asset faltando. Cada partícula cintila em fase própria e deriva devagar
// ao redor da câmera, dentro de uma casca esférica.
function createDustField(cfg) {
    const count = cfg.count;
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const velocities = new Float32Array(count * 3);
    const radii = new Float32Array(count);

    function randomInShell(i) {
        const r = cfg.radiusMin + Math.random() * (cfg.radiusMax - cfg.radiusMin);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        radii[i] = r;
    }

    for (let i = 0; i < count; i++) {
        randomInShell(i);
        phases[i] = Math.random() * Math.PI * 2;
        speeds[i] = 0.6 + Math.random() * 0.8;
        // deriva lenta e aleatória por partícula (movimento tipo poeira no ar).
        velocities[i * 3] = (Math.random() - 0.5) * cfg.driftSpeed;
        velocities[i * 3 + 1] = (Math.random() - 0.5) * cfg.driftSpeed * 0.6;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * cfg.driftSpeed;
    }

    const geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', posAttr);
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uSize: { value: cfg.size },
            uOpacity: { value: cfg.opacity },
            uColor: { value: new THREE.Vector3(cfg.color[0], cfg.color[1], cfg.color[2]) },
        },
        vertexShader: /* glsl */`
            attribute float aPhase;
            attribute float aSpeed;
            uniform float uTime;
            uniform float uSize;
            varying float vTwinkle;
            void main() {
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = uSize * (300.0 / -mvPosition.z);
                vTwinkle = 0.4 + 0.6 * (0.5 + 0.5 * sin(uTime * aSpeed + aPhase));
            }`,
        fragmentShader: /* glsl */`
            uniform float uOpacity;
            uniform vec3 uColor;
            varying float vTwinkle;
            void main() {
                float d = length(gl_PointCoord - 0.5);
                float alpha = smoothstep(0.5, 0.0, d);
                gl_FragColor = vec4(uColor, alpha * uOpacity * vTwinkle);
            }`,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;

    function update(time, dt) {
        const posArr = geometry.attributes.position.array;
        for (let i = 0; i < count; i++) {
            posArr[i * 3] += velocities[i * 3] * dt;
            posArr[i * 3 + 1] += velocities[i * 3 + 1] * dt;
            posArr[i * 3 + 2] += velocities[i * 3 + 2] * dt;
            // Se a partícula deriva pra muito longe da casca, reposiciona (wrap).
            const dist = Math.hypot(posArr[i * 3], posArr[i * 3 + 1], posArr[i * 3 + 2]);
            if (dist > cfg.radiusMax || dist < cfg.radiusMin * 0.5) {
                randomInShell(i);
                posArr[i * 3] = positions[i * 3];
                posArr[i * 3 + 1] = positions[i * 3 + 1];
                posArr[i * 3 + 2] = positions[i * 3 + 2];
            }
        }
        geometry.attributes.position.needsUpdate = true;
        material.uniforms.uTime.value = time;
    }

    return { points, update };
}

// ── Camada 2D (mobs/HUD sobre o mapa): mesmo grading + vinheta + tint ───
function applyDomLayer(cont) {
    if (document.getElementById('pfx-dom-style')) return; // já injetado (evita duplicar)
    const cfg = POSTFX_CONFIG.colorGrade;
    const style = document.createElement('style');
    style.id = 'pfx-dom-style';
    style.textContent = `
        #map {
            filter: contrast(${cfg.contrast}) saturate(${cfg.saturation});
            transition: filter .18s linear;
        }
        .pfx-vignette {
            position: absolute; inset: 0; z-index: 2; pointer-events: none;
            background: radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${(0.55 * cfg.vignetteStrength).toFixed(3)}) 100%);
        }
        .pfx-ambient {
            position: absolute; inset: 0; z-index: 2; pointer-events: none;
            mix-blend-mode: soft-light;
            background: rgb(${Math.round(cfg.tint[0] * 255)}, ${Math.round(cfg.tint[1] * 255)}, ${Math.round(cfg.tint[2] * 255)});
            opacity: ${cfg.tintStrength};
        }
    `;
    document.head.appendChild(style);

    const vignette = document.createElement('div');
    vignette.className = 'pfx-vignette';
    const ambient = document.createElement('div');
    ambient.className = 'pfx-ambient';
    cont.appendChild(vignette);
    cont.appendChild(ambient);
}

// ── Inicialização principal ─────────────────────────────────────────────
// Chame depois de criar scene/camera/renderer do skybox. Retorna um objeto
// com render(scene,camera) e resize(w,h) — use no lugar de renderer.render()
// direto no loop, e no listener de resize.
export function initPostFX({ scene, camera, renderer, cont }) {
    const width = cont.clientWidth, height = cont.clientHeight;

    const composer = new EffectComposer(renderer);
    composer.setSize(width, height);
    composer.addPass(new RenderPass(scene, camera));

    let bloomPass = null;
    try {
        if (POSTFX_CONFIG.bloom.enabled) {
            bloomPass = new UnrealBloomPass(
                new THREE.Vector2(width, height),
                POSTFX_CONFIG.bloom.strength,
                POSTFX_CONFIG.bloom.radius,
                POSTFX_CONFIG.bloom.threshold
            );
            composer.addPass(bloomPass);
        }
    } catch (e) { console.warn('[PostFX] Bloom indisponível:', e); bloomPass = null; }

    let colorGradePass = null;
    try {
        if (POSTFX_CONFIG.colorGrade.enabled) {
            colorGradePass = new ShaderPass(ColorGradeShader);
            const cfg = POSTFX_CONFIG.colorGrade;
            colorGradePass.uniforms.uTint.value.set(cfg.tint[0], cfg.tint[1], cfg.tint[2]);
            colorGradePass.uniforms.uTintStrength.value = cfg.tintStrength;
            colorGradePass.uniforms.uContrast.value = cfg.contrast;
            colorGradePass.uniforms.uSaturation.value = cfg.saturation;
            colorGradePass.uniforms.uVignetteStrength.value = cfg.vignetteStrength;
            const sh = POSTFX_CONFIG.shimmer;
            colorGradePass.uniforms.uShimmerEnabled.value = sh.enabled ? 1.0 : 0.0;
            colorGradePass.uniforms.uShimmerThreshold.value = sh.threshold;
            colorGradePass.uniforms.uShimmerBrightMin.value = sh.brightMin;
            colorGradePass.uniforms.uShimmerIntensity.value = sh.intensity;
            colorGradePass.uniforms.uShimmerDensity.value = sh.density;
            colorGradePass.uniforms.uShimmerSpeed.value = sh.speed;
            colorGradePass.uniforms.uShimmerColor.value.set(sh.color[0], sh.color[1], sh.color[2]);
            composer.addPass(colorGradePass);
        }
    } catch (e) { console.warn('[PostFX] Color grade/shimmer indisponível:', e); colorGradePass = null; }

    let lensFlarePass = null;
    try {
        if (POSTFX_CONFIG.lensFlare.enabled) {
            lensFlarePass = new ShaderPass(LensFlareShader);
            const cfg = POSTFX_CONFIG.lensFlare;
            lensFlarePass.uniforms.uThreshold.value = cfg.threshold;
            lensFlarePass.uniforms.uIntensity.value = cfg.intensity;
            lensFlarePass.uniforms.uGhosts.value = cfg.ghosts;
            lensFlarePass.uniforms.uStreak.value = cfg.streak;
            lensFlarePass.uniforms.uChromaticAberration.value = cfg.chromaticAberration;
            composer.addPass(lensFlarePass);
        }
    } catch (e) { console.warn('[PostFX] Lens flare indisponível:', e); lensFlarePass = null; }

    let motionBlurPass = null;
    try {
        if (POSTFX_CONFIG.motionBlur.enabled) {
            motionBlurPass = new ShaderPass(MotionBlurShader);
            composer.addPass(motionBlurPass);
        }
    } catch (e) { console.warn('[PostFX] Motion blur indisponível:', e); motionBlurPass = null; }

    composer.addPass(new OutputPass());

    let dustField = null;
    try {
        if (POSTFX_CONFIG.dust.enabled) {
            dustField = createDustField(POSTFX_CONFIG.dust);
            scene.add(dustField.points);
        }
    } catch (e) { console.warn('[PostFX] Poeira mágica indisponível:', e); dustField = null; }

    if (POSTFX_CONFIG.domLayer.enabled) applyDomLayer(cont);

    const clock = new THREE.Clock();
    let lastElapsed = 0;

    // ── Rastreamento de velocidade angular real da câmera (pra motion blur) ──
    const prevDir = camera.getWorldDirection(new THREE.Vector3());
    let smoothedAmount = 0;
    const map = document.getElementById('map');
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function updateMotionBlur(cam) {
        if (!motionBlurPass) return;
        const curDir = cam.getWorldDirection(new THREE.Vector3());
        const angle = prevDir.angleTo(curDir); // radianos que a câmera girou desde o último frame
        prevDir.copy(curDir);

        const targetAmount = reduceMotion ? 0 : Math.min(
            POSTFX_CONFIG.motionBlur.maxAmount,
            angle * POSTFX_CONFIG.motionBlur.sensitivity
        );
        const s = POSTFX_CONFIG.motionBlur.smoothing;
        smoothedAmount = smoothedAmount * s + targetAmount * (1 - s);

        motionBlurPass.uniforms.uAmount.value = smoothedAmount;

        // Direção aproximada do borrão em espaço de tela (eixo direita/cima da câmera).
        const camRight = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
        const camUp = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
        const delta = new THREE.Vector3().subVectors(curDir, prevDir);
        let dx = delta.dot(camRight), dy = delta.dot(camUp);
        const mag = Math.hypot(dx, dy);
        if (mag > 0.00001) { dx /= mag; dy /= mag; } else { dx = 1; dy = 0; }
        motionBlurPass.uniforms.uDirection.value.set(dx, dy);

        // Espelha um leve blur na camada DOM (mobs/HUD) pra acompanhar o mesmo movimento.
        if (map && POSTFX_CONFIG.domLayer.enabled) {
            const pxBlur = smoothedAmount * width * 0.35;
            map.style.filter = pxBlur > 0.15
                ? `contrast(${POSTFX_CONFIG.colorGrade.contrast}) saturate(${POSTFX_CONFIG.colorGrade.saturation}) blur(${pxBlur.toFixed(2)}px)`
                : `contrast(${POSTFX_CONFIG.colorGrade.contrast}) saturate(${POSTFX_CONFIG.colorGrade.saturation})`;
        }
    }

    return {
        render(sceneArg, cameraArg) {
            const elapsed = clock.getElapsedTime();
            const dt = Math.min(0.1, elapsed - lastElapsed); // trava dt em cenários de frame longo/aba em segundo plano
            lastElapsed = elapsed;

            if (colorGradePass) colorGradePass.uniforms.uTime.value = elapsed;
            if (dustField) {
                try { dustField.update(elapsed, dt); }
                catch (e) { console.warn('[PostFX] Erro ao animar poeira mágica:', e); }
            }

            updateMotionBlur(cameraArg);
            composer.render();
        },
        resize(w, h) {
            composer.setSize(w, h);
        },
        composer,
        passes: { bloomPass, colorGradePass, lensFlarePass, motionBlurPass, dustField },
    };
}
