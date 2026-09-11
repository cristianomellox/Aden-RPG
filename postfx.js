
// como specifier nu — sem o import map, o navegador não consegue resolver isso.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Marcador de versão — se essa linha NÃO aparecer no console do navegador
// ao abrir a loja, o arquivo que está rodando é uma versão em cache, não
// esta aqui. Force um hard refresh (Ctrl+Shift+R) ou limpe o cache.
console.log('[postfx.js] versão carregada: sombra-v3 (renderOrder acima do NPC + map em vez de alphaMap)');

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

    // Motion blur direcional, proporcional à velocidade angular real da
    // câmera (ver updateMotionBlur) — some sozinho quando a câmera para.
    motionBlur: {
        enabled: true,
        maxAmount: 0.035,   // teto do deslocamento de amostragem (em UV, 0-1)
        sensitivity: 2.2,   // rad/frame → uAmount
        smoothing: 0.72,    // 0 = reage instantâneo, 1 = nunca muda (suaviza o "liga/desliga")
    },

    // Reflete o mesmo grading na camada 2D (mobs/HUD sobre o mapa) pra tudo
    // parecer uma cena só, e reforça sombra de contato (fake AO) + vinheta.
    domLayer: {
        enabled: true,
    },

    // Sombra projetada do NPC (mestre de poções / ferreiro / mercador):
    // clona a silhueta do próprio sprite do NPC (via "map" + cor preta) e
    // deita no "chão" na direção oposta ao ponto mais claro do skybox 360°.
    npcShadow: {
        enabled: true,
        opacity: 0.5,        // opacidade no centro (as bordas já ficam mais claras sozinhas, por causa do desfoque)
        blurFrac: 0.090,     // raio do desfoque como fração da largura da imagem do NPC (não px fixo — se adapta a qualquer resolução de asset). Suba pra sombra mais "nublada", desça pra mais definida
        baseSquash: 0.64,   // o quanto a silhueta é achatada antes de esticar pela luz
        minStretch: 0.7,    // sombra mínima (luz quase a pino)
        maxStretch: 1.7,    // sombra máxima (luz rente ao horizonte)
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
// mapEl: elemento cuja filter (contraste/saturação, e depois o blur do
// motion blur) recebe o grading — passe explicitamente quando houver mais
// de um skybox+camada-2D na mesma página (ex.: mapa da cidade + cenário do
// Mestre de Poções), senão cai no #map padrão (compatível com covil_de_kelts.js).
function applyDomLayer(cont, mapEl) {
    const cfg = POSTFX_CONFIG.colorGrade;
    const target = mapEl || document.getElementById('map');
    if (target) {
        target.style.filter = `contrast(${cfg.contrast}) saturate(${cfg.saturation})`;
        target.style.transition = 'filter .18s linear';
    }

    // O <style> com .pfx-vignette/.pfx-ambient é compartilhado (classes
    // genéricas, sem depender de qual página/skybox chamou) — só injeta uma
    // vez. IMPORTANTE: isso não pode pular a criação das divs abaixo, ou a
    // segunda chamada (2º skybox da mesma página) fica sem vinheta/ambient.
    if (!document.getElementById('pfx-dom-style')) {
        const style = document.createElement('style');
        style.id = 'pfx-dom-style';
        style.textContent = `
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
    }

    const vignette = document.createElement('div');
    vignette.className = 'pfx-vignette';
    const ambient = document.createElement('div');
    ambient.className = 'pfx-ambient';
    cont.appendChild(vignette);
    cont.appendChild(ambient);
}

// ── Detecção do ponto de luz mais forte do skybox 360° ──────────────────
// A imagem do skybox é equirretangular (mapeada na SphereGeometry com
// .scale(-1,1,1) — ver initXxSkybox). Aqui a gente desenha essa imagem
// num canvas pequeno (rápido), acha a região mais clara (mesmo critério
// de luminância do ColorGradeShader acima) e converte a posição do pixel
// pra yaw/pitch usando a MESMA convenção de pmYawPitchToVector/
// ofYawPitchToVector/mcYawPitchToVector (derivado da geometria real da
// esfera: u=phi/2π, v=1-theta/π, com a imagem lida top-down e
// texture.flipY padrão do three.js). Não precisa bater 100% no primeiro
// teste — ver DEBUG abaixo pra calibrar visualmente, e dá pra sobrescrever
// manualmente por loja (ver PM_LIGHT_OVERRIDE nos arquivos de cidade).
export function estimateLightDirectionFromEquirect(texture, { debug = false } = {}) {
    const fallback = { yaw: 200, pitch: 55 }; // luz genérica vinda de trás/cima, caso a leitura falhe (ex.: canvas "tainted" por CORS)
    try {
        const img = texture.image;
        if (!img || !img.width || !img.height) return fallback;

        const W = 96, H = 48; // downscale — só precisa achar a região mais clara, não detalhe
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, W, H);
        const { data } = ctx.getImageData(0, 0, W, H);

        // Luminância por pixel (mesmos coeficientes do ColorGradeShader).
        const luma = new Float32Array(W * H);
        let maxL = 0, sumL = 0;
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            const l = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
            luma[p] = l;
            if (l > maxL) maxL = l;
            sumL += l;
        }
        const avgL = sumL / luma.length;

        // Centróide ponderado só dos pixels realmente "quentes" (ex.: janela,
        // tocha, brasa, feixe de sol) — evita que o piso claro médio puxe o
        // resultado pro meio do chão.
        const threshold = Math.max(avgL + (maxL - avgL) * 0.55, maxL * 0.75, 0.001);
        let sw = 0, sx = 0, sy = 0;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const l = luma[y * W + x];
                if (l < threshold) continue;
                const w = (l - threshold) + 0.001;
                sw += w; sx += w * (x + 0.5); sy += w * (y + 0.5);
            }
        }
        if (sw <= 0) return fallback; // cena muito uniforme/escura — sem ponto de luz claro

        const px = sx / sw, py = sy / sw;
        const uFrac = px / W, vFrac = py / H;

        // phi = uFrac*2π, theta = vFrac*π (topo da imagem = zênite, base = nadir).
        // yaw = 90° - phi, pitch = 90° - theta (graus) — ver derivação nos
        // comentários de createNpcGroundShadow logo abaixo.
        let yaw = 90 - uFrac * 360;
        let pitch = 90 - vFrac * 180;
        yaw = ((yaw % 360) + 360) % 360;
        pitch = THREE.MathUtils.clamp(pitch, -85, 85);

        console.log('[Sombra] Luz estimada do skybox → yaw:', yaw.toFixed(1), '° pitch:', pitch.toFixed(1), '° (imagem', img.width + 'x' + img.height + ')');
        return { yaw, pitch };
    } catch (e) {
        console.error('[Sombra] Não foi possível ler os pixels do skybox (provável CORS na imagem) — usando direção de luz padrão.', e);
        return fallback;
    }
}

// ── Sombra projetada do NPC (silhueta clonada, deitada no "chão") ───────
// Em vez do círculo/elipse genérico de antes, usa a MESMA textura do
// sprite do NPC (via "map" + color preto — não "alphaMap", ver comentário
// na função abaixo) num plano preto e transparente: o formato da sombra é
// o recorte real do personagem. O plano é deitado no chão (fica
// perpendicular à esfera do skybox, não mais um billboard voltado pra
// câmera) e girado pra apontar pro lado OPOSTO ao ponto de luz mais
// forte — por isso, ao girar o cenário, ela se comporta como uma sombra
// de verdade (a perspectiva muda com o ângulo de visão), em vez de ficar
// sempre de frente pra câmera como antes.
//
// Matemática (resumo p/ quem for mexer depois): o plano nasce no eixo XY
// (ThreE.PlaneGeometry) com a base (pé do NPC) na origem. Aplicamos duas
// rotações via quaternion, NA ORDEM CERTA (por isso não usamos
// mesh.rotation.x/y direto — a ordem padrão XYZ do Euler do three.js
// combinaria as rotações fora de ordem e tornaria o "chão" torto):
//   1) "deitar" -90° no eixo X local (a silhueta passa a ficar plana,
//      no plano XZ do mundo);
//   2) "girar" no eixo Y do MUNDO pelo ângulo da luz — prova-se que esse
//      ângulo de giro é exatamente igual ao yaw da luz (em radianos),
//      sem precisar somar/inverter nada.
function buildShadowQuaternion(lightYawDeg) {
    const flatten = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(lightYawDeg));
    return spin.multiply(flatten); // aplica "flatten" primeiro, "spin" depois
}

function stretchFromPitch(lightPitchDeg) {
    const cfg = POSTFX_CONFIG.npcShadow;
    const p = THREE.MathUtils.clamp(lightPitchDeg, 8, 85); // luz muito rasteira (<8°) já vira sombra absurdamente comprida — trava
    const stretch = 1 / Math.tan(THREE.MathUtils.degToRad(p));
    return THREE.MathUtils.clamp(stretch, cfg.minStretch, cfg.maxStretch);
}

// cont/mapEl não são necessários aqui (a sombra vive só no mundo 3D).
// ── Versão suave/desfocada da silhueta do NPC ───────────────────────────
// Usar o recorte nítido do personagem direto como sombra parece um
// "decalque" colado no chão. Jogos AAA usam sombras de contato bem
// suaves — aqui desenhamos o personagem num canvas com blur real do
// Canvas 2D (ctx.filter = 'blur()') numa margem extra ao redor (senão o
// desfoque corta feio na borda do canvas). Como isso aumenta o tamanho
// da imagem, devolvemos também os fatores de escala e onde ficam os
// "pés" dentro da imagem nova, pra createNpcGroundShadow conseguir
// recalcular o tamanho/âncora do plano corretamente.
function createSoftSilhouetteTexture(npcTexture, blurFrac) {
    const img = npcTexture.image;
    // Raio do desfoque em PROPORÇÃO à resolução real da imagem do NPC, não
    // um valor fixo em px — assim funciona igual não importa se o asset é
    // um PNG pequeno ou uma imagem gigante em alta resolução.
    const blurPx = Math.max(4, Math.round(img.width * blurFrac));
    const pad = Math.max(2, Math.round(blurPx * 3)); // margem suficiente pro blur não cortar na borda
    const w = img.width + pad * 2;
    const h = img.height + pad * 2;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.filter = `blur(${blurPx}px)`;
    ctx.drawImage(img, pad, pad, img.width, img.height);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;

    return {
        texture: tex,
        scaleX: w / img.width,
        scaleY: h / img.height,
        feetFrac: pad / h, // fração da altura nova que fica ABAIXO dos pés originais (a margem de baixo)
    };
}

export function createNpcGroundShadow({ scene, npcTexture, worldWidth, worldHeight, feetPosition, lightYaw = 200, lightPitch = 55, cameraYaw = 0 }) {
  try {
    const cfg = POSTFX_CONFIG.npcShadow;
    const soft = createSoftSilhouetteTexture(npcTexture, cfg.blurFrac);
    const shadowTexture = soft.texture;
    // O plano cresce um pouco (pela margem do blur) — reescala mantendo o
    // "pé" do personagem no mesmo lugar do mundo.
    const paddedWidth = worldWidth * soft.scaleX;
    const paddedHeight = worldHeight * soft.scaleY;

    const material = new THREE.MeshBasicMaterial({
        map: shadowTexture,     // versão suave/desfocada (ver createSoftSilhouetteTexture acima) — não a textura nítida do NPC
        color: 0x000000,        // força preto puro (o RGB do sprite é multiplicado pela cor, então zera as cores originais)
        // IMPORTANTE: é "map", não "alphaMap". alphaMap no three.js lê o
        // canal VERDE do RGB (não o canal alfa de verdade) — com um NPC de
        // roupa escura isso deixava o alfa calculado perto de zero na
        // maior parte do corpo e a sombra ficava praticamente invisível.
        // "map" usa o alfa real do PNG/WEBP, que é o que precisamos.
        transparent: true,
        opacity: cfg.opacity,
        depthWrite: false,
        depthTest: false,       // mesmo critério do sprite antigo — nunca é "engolida" pela esfera do skybox
        side: THREE.DoubleSide,
        toneMapped: false,
    });

    const geometry = new THREE.PlaneGeometry(paddedWidth, paddedHeight, 1, 1);
    // Pivô nos "pés" — mas agora precisa descontar a margem extra que o
    // blur adicionou embaixo (soft.feetFrac), senão a sombra flutua
    // deslocada dos pés de verdade do NPC.
    const feetOffsetWorld = paddedHeight * soft.feetFrac;
    geometry.translate(0, paddedHeight / 2 - feetOffsetWorld, 0);

    const mesh = new THREE.Mesh(geometry, material);
    // IMPORTANTE: renderOrder ACIMA do sprite do NPC (999), não abaixo.
    // O NPC é um recorte 2D achatado (sprite), sem volume de verdade. Toda
    // vez que a luz vem de trás/de cima da câmera (ex.: um lampião no teto,
    // atrás do personagem — o caso mais comum nessas lojas), a sombra "cai"
    // pra dentro da tela, na mesma região de tela que o corpo do próprio
    // NPC — e como o NPC não tem profundidade real, ele simplesmente
    // tampava a sombra por completo (foi isso que reproduzimos e
    // confirmamos com um teste de renderização real antes de corrigir).
    // Desenhando a sombra por cima, ela sempre aparece; o único efeito
    // colateral é que, nesse ângulo específico de luz, ela pode encostar
    // visualmente na base da bota do NPC em vez de ficar 100% atrás — troca
    // justa por nunca mais sumir.
    mesh.renderOrder = 1000;
    mesh.position.copy(feetPosition);

    scene.add(mesh);

    // Log sempre ativo (não só com ?debugShadow=1) — assim dá pra conferir
    // no console do navegador se a sombra foi criada e com que valores,
    // sem precisar de parâmetro nenhum na URL.
    console.log('[Sombra] NPC shadow criada:', {
        posição: mesh.position.toArray().map(n => +n.toFixed(1)),
        larguraMundo: +worldWidth.toFixed(1),
        alturaMundo: +worldHeight.toFixed(1),
        opacidade: material.opacity,
        renderOrder: mesh.renderOrder,
        lightYaw, lightPitch,
    });

    const state = { mesh, baseStretch: cfg.baseSquash };
    updateNpcGroundShadowLight(state, lightYaw, lightPitch, cameraYaw);
    return state;
  } catch (e) {
    // Se isso disparar, o erro ficaria mudo antes (a criação da sombra
    // rodava dentro do mesmo callback de carga da textura do NPC — uma
    // exceção aqui abortava silenciosamente o resto da inicialização,
    // inclusive a respiração). Agora fica logado e a função só retorna
    // null, sem quebrar o resto do fluxo.
    console.error('[Sombra] Falha ao criar a sombra do NPC:', e);
    return null;
  }
}

// Chame de novo sempre que a estimativa de luz mudar (ex.: quando a
// textura do skybox termina de carregar depois do NPC).
export function updateNpcGroundShadowLight(state, lightYaw, lightPitch, cameraYaw = 0) {
    if (!state || !state.mesh) return;
    // Guarda o ângulo relativo entre a luz e a câmera no momento do
    // cálculo — não o yaw absoluto. É esse ângulo relativo que fica fixo
    // (ver updateNpcGroundShadowCamera), não a direção no mundo.
    state.relativeYaw = lightYaw - cameraYaw;
    state.mesh.quaternion.copy(buildShadowQuaternion(lightYaw)); // aplica de imediato, na orientação atual da câmera
    state.baseStretch = POSTFX_CONFIG.npcShadow.baseSquash * stretchFromPitch(lightPitch);
    state.mesh.scale.set(1, state.baseStretch, 1);
    state.lightYaw = lightYaw;
    state.lightPitch = lightPitch;
}

// ── Sombra "gruda" no giro da câmera (chame isso a cada frame) ──────────
// O sprite do NPC é um billboard: sempre vira pra encarar a câmera, então
// dá a impressão de "girar junto" conforme o jogador olha ao redor. Uma
// sombra com direção fixa no MUNDO não acompanha esse giro (ela fica
// "parada" enquanto o personagem parece girar) — e é isso que cria a
// sensação de dois corpos separados.
//
// A correção: manter fixo o ÂNGULO RELATIVO entre a câmera e a sombra
// (calculado uma vez em updateNpcGroundShadowLight, guardado em
// state.relativeYaw), e a cada frame reaplicar esse ângulo relativo em
// cima do yaw ATUAL da câmera. Na prática, a sombra passa a girar junto
// com o "giro" aparente do personagem, como se estivesse soldada nele —
// exatamente como um billboard, só que deitada no chão em vez de sempre
// de frente pra câmera.
export function updateNpcGroundShadowCamera(state, cameraYawDeg) {
    if (!state || !state.mesh || state.relativeYaw == null) return;
    state.mesh.quaternion.copy(buildShadowQuaternion(state.relativeYaw + cameraYawDeg));
}

// ── Inicialização principal ─────────────────────────────────────────────
// Chame depois de criar scene/camera/renderer do skybox. Retorna um objeto
// com render(scene,camera) e resize(w,h) — use no lugar de renderer.render()
// direto no loop, e no listener de resize.
export function initPostFX({ scene, camera, renderer, cont, mapEl }) {
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

    if (POSTFX_CONFIG.domLayer.enabled) applyDomLayer(cont, mapEl);

    // ── Rastreamento de velocidade angular real da câmera (pra motion blur) ──
    const prevDir = camera.getWorldDirection(new THREE.Vector3());
    let smoothedAmount = 0;
    const map = mapEl || document.getElementById('map');
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
