// ══════════════════════════════════════════════════════════════════════
// POSTFX — Camada de pós-processamento WebGL (Three.js) para o skybox 360°
// ──────────────────────────────────────────────────────────────────────
// Pipeline real (roda na GPU via WebGLRenderer + EffectComposer):
//   RenderPass → UnrealBloomPass (brilho/bloom) → ColorGradePass (tint
//   ambiente + contraste + saturação + vinheta) → MotionBlurPass (borrão
//   direcional proporcional à velocidade angular real da câmera) → OutputPass.
//
// Sobre limites honestos: isto roda sobre uma única esfera (skybox), então
// Global Illumination "de verdade" (luz que bate e ricocheteia entre
// superfícies) e SSAO "de verdade" (oclusão calculada a partir de
// profundidade/normais de uma cena 3D complexa) não fazem sentido físico
// aqui — não existe geometria suficiente pra isso simular algo visível.
// Em vez de fingir algo que não existiria, este módulo entrega o que É
// real e visível: "iluminação ambiente global" na forma de um tint de cor
// configurável (exatamente o que motores usam pra dar "mood" de cor geral
// à cena), e compensa a falta de AO 3D reforçando o contato/vinheta na
// camada 2D (sombras dos mobs, escurecimento nas bordas) — ver
// applyDomLayer() mais abaixo, chamado a partir do mesmo config.
// ══════════════════════════════════════════════════════════════════════

// Usa os specifiers "three" e "three/addons/" do import map (declarado no
// <head> de cada página, antes do <script type="module">). Isso é necessário
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
        strength: 0.75,   // intensidade do brilho
        radius: 0.65,     // o quanto o brilho "espalha"
        threshold: 0.72,  // só pixels mais claros que isso brilham (0-1)
    },
    // "Iluminação ambiente global" (tint de cor) + contraste/saturação + vinheta.
    colorGrade: {
        enabled: true,
        tint: [1.0, 0.965, 0.9],  // cor da luz ambiente (levemente quente/dourada)
        tintStrength: 0.16,        // 0 = neutro, 1 = tint total
        contrast: 0.5,
        saturation: 1.0,
        vignetteStrength: 0.22,
    },
    // Motion blur direcional, proporcional à velocidade angular real da câmera.
    motionBlur: {
        enabled: true,
        sensitivity: 5.2,   // quanto maior, mais sensível a giros rápidos
        maxAmount: 0.045,   // borrão máximo (em UV, ~ % da tela)
        smoothing: 0.45,    // suavização entre frames (0-1, maior = mais suave)
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
        varying vec2 vUv;
        void main() {
            vec4 color = texture2D(tDiffuse, vUv);

            // "Luz ambiente global": tint multiplicativo suave sobre a cena inteira.
            color.rgb = mix(color.rgb, color.rgb * uTint, uTintStrength);

            // Contraste em torno do ponto médio.
            color.rgb = (color.rgb - 0.5) * uContrast + 0.5;

            // Saturação via mistura com a luminância (percepção humana).
            float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
            color.rgb = mix(vec3(luma), color.rgb, uSaturation);

            // Vinheta suave nas bordas (reforça profundidade / "ambient occlusion" de tela).
            float dist = length(vUv - 0.5) * 1.4142;
            float vig = smoothstep(1.0, 0.35, dist);
            color.rgb *= mix(1.0, vig, uVignetteStrength);

            gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
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
    if (POSTFX_CONFIG.bloom.enabled) {
        bloomPass = new UnrealBloomPass(
            new THREE.Vector2(width, height),
            POSTFX_CONFIG.bloom.strength,
            POSTFX_CONFIG.bloom.radius,
            POSTFX_CONFIG.bloom.threshold
        );
        composer.addPass(bloomPass);
    }

    let colorGradePass = null;
    if (POSTFX_CONFIG.colorGrade.enabled) {
        colorGradePass = new ShaderPass(ColorGradeShader);
        const cfg = POSTFX_CONFIG.colorGrade;
        colorGradePass.uniforms.uTint.value.set(cfg.tint[0], cfg.tint[1], cfg.tint[2]);
        colorGradePass.uniforms.uTintStrength.value = cfg.tintStrength;
        colorGradePass.uniforms.uContrast.value = cfg.contrast;
        colorGradePass.uniforms.uSaturation.value = cfg.saturation;
        colorGradePass.uniforms.uVignetteStrength.value = cfg.vignetteStrength;
        composer.addPass(colorGradePass);
    }

    let motionBlurPass = null;
    if (POSTFX_CONFIG.motionBlur.enabled) {
        motionBlurPass = new ShaderPass(MotionBlurShader);
        composer.addPass(motionBlurPass);
    }

    composer.addPass(new OutputPass());

    if (POSTFX_CONFIG.domLayer.enabled) applyDomLayer(cont);

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
            updateMotionBlur(cameraArg);
            composer.render();
        },
        resize(w, h) {
            composer.setSize(w, h);
        },
        composer,
        passes: { bloomPass, colorGradePass, motionBlurPass },
    };
}
