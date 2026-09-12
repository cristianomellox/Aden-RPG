import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';
import { initPostFX, POSTFX_CONFIG } from './postfx.js';

// ═══════════════════════════════════════════════════════════════════════
// SKYBOX 360° DA TELA DE LOGIN (Three.js) ────────────────────────────────
// Substitui o antigo background-image estático do #authContainer por uma
// esfera panorâmica com uma câmera girando sozinha, bem devagar, só no
// eixo horizontal (yaw) — SEM pitch, SEM drag, SEM zoom.
//
// DOIS dragões, um voando pra cada lado (direita→esquerda e
// esquerda→direita), cada um com seu próprio relógio de voo/pausa
// SORTEADO (não fixo) — pra nunca parecer robótico e permitir, às vezes,
// os dois voando ao mesmo tempo. A altura de cada voo também é sorteada,
// mas sempre respeitando uma distância mínima entre os dois dragões pra
// eles nunca "passarem um por dentro do outro" na tela.
//
// AJUSTE DE PÓS-PROCESSAMENTO (só nesta página): o postfx.js é
// COMPARTILHADO com outras telas (Floresta Mística etc.), então ele não é
// editado. Só ajustamos, em runtime, os números de POSTFX_CONFIG.bloom
// ANTES de chamar initPostFX() — isso só existe dentro da instância deste
// módulo carregada por ESTA página (cada página carrega sua própria cópia
// do postfx.js), então não afeta nenhuma outra tela do jogo. Isso faz o
// bloom pegar também os raios do céu, não só o sol. Além disso, o fogo
// saindo da boca do dragão ganha um brilho aditivo dedicado (um sprite
// extra, pulsante), pra garantir o efeito "prestes a cuspir fogo" mesmo
// que o bloom genérico não pegue bem aquela região da arte.
// ═══════════════════════════════════════════════════════════════════════

const SKY_IMAGE_URL    = '/assets/aden_ini_sb.png';
const DRAGON_IMAGE_URL = '/assets/mon_dg_auth.png';

// ── Câmera (gira sozinha, devagar, só no eixo horizontal) ───────────────
const CAM_FOV               = 88;
const CAM_PITCH_DEG         = -3;               // fixo — nunca muda (sem movimento vertical)
const ROTATE_DEG_PER_SEC    = 360 / 150;        // 1 volta completa a cada 150s — bem suave

// ── Dragões (billboards planando pelo céu) ───────────────────────────────
const DRAGON_HEIGHT_FRAC    = 0.13;             // fração da altura da tela ocupada pelo dragão
const DRAGON_REF_DISTANCE   = 320;              // distância de referência p/ calcular o tamanho do sprite
const DRAGON_DIST_MIN       = 260;              // distância real do voo é sorteada nesse intervalo —
const DRAGON_DIST_MAX       = 380;              // dá uma leve variação de profundidade/perspectiva entre voos
const DRAGON_BOB_AMPL       = 0.018;            // leve ondulação vertical (efeito de planar)
const DRAGON_BOB_FREQ_HZ    = 0.22;
const DRAGON_TILT_AMPL_RAD  = 0.035;            // leve inclinação, como se o vento balançasse o voo
const DRAGON_NDC_EDGE       = 1.2;              // ponto de entrada/saída de tela (um pouco além de ±1 = fora da tela)
const DRAGON_FLIGHT_MS_MIN  = 13000;
const DRAGON_FLIGHT_MS_MAX  = 19000;            // duração do voo sorteada — evita ficar robótico
const DRAGON_PAUSE_MS_MIN   = 3000;
const DRAGON_PAUSE_MS_MAX   = 15000;            // pausa entre voos sorteada — às vezes os dois voam juntos,
                                                 // às vezes só um, às vezes nenhum por um tempo
const DRAGON_FIRST_DELAY_MIN = 1200;
const DRAGON_FIRST_DELAY_MAX = 4500;

// Faixa vertical (em NDC, -1..1) onde os dragões podem aparecer — região
// do céu, acima da caixa de login.
const DRAGON_Y_MIN           = 0.08;
const DRAGON_Y_MAX           = 0.70;
// Separação vertical mínima (NDC) entre os dois dragões, pra nunca
// sobrepor visualmente (a "altura" de um dragão em NDC gira em torno de
// 2×DRAGON_HEIGHT_FRAC ≈ 0.26 — por isso a folga aqui é maior que isso).
const DRAGON_MIN_Y_GAP        = 0.30;

// Posição aproximada da boca (fração da imagem ORIGINAL, sem espelhar:
// 0 = borda esquerda/topo, 1 = borda direita/base). A cabeça do dragão
// fica do lado direito da arte, com a boca aberta soltando uma luz
// amarela — ajuste esses dois números se a arte final não bater 100%.
const MOUTH_FRAC_X = 0.90;
const MOUTH_FRAC_Y = 0.47;
const MOUTH_GLOW_SIZE_FRAC = 0.55; // tamanho do brilho, relativo à altura do dragão

// ── Configuração dos dois dragões: direção, ponto de entrada/saída e se
// usa a textura espelhada (ver nota sobre THREE.Sprite mais abaixo). ────
const DRAGON_PROFILES = [
    { id: 'left',  startNdcX:  DRAGON_NDC_EDGE, endNdcX: -DRAGON_NDC_EDGE, flip: true  }, // direita → esquerda
    { id: 'right', startNdcX: -DRAGON_NDC_EDGE, endNdcX:  DRAGON_NDC_EDGE, flip: false }, // esquerda → direita
];

let _sky = null;      // { scene, camera, renderer, canvas, cont, running, raf, pfx, _onResize }
let _dragons = [];    // [{ id, sprite, material, glowSprite, glowMaterial, ndcX, ndcY, ... }]
let _camYaw = 0;
let _lastTs = 0;

const _dragonTexCache = { base: null, flipped: null };
let _glowTexture = null;

function randBetween(min, max) { return min + Math.random() * (max - min); }

// Converte yaw/pitch (graus) num vetor direção unitário — mesma convenção
// usada na Floresta Mística (yaw=0,pitch=0 aponta pra +Z).
function yawPitchToVector(yawDeg, pitchDeg, radius = 1) {
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    return new THREE.Vector3(
        radius * Math.sin(yaw) * Math.cos(pitch),
        radius * Math.sin(pitch),
        radius * Math.cos(yaw) * Math.cos(pitch)
    );
}

function updateCameraLook() {
    if (!_sky) return;
    const dir = yawPitchToVector(_camYaw, CAM_PITCH_DEG, 1);
    _sky.camera.lookAt(dir.x, dir.y, dir.z);
}

// ── DOM: cria a camada do skybox como PRIMEIRO filho de #authContainer ──
// z-index -1 garante que ela fica ATRÁS de todo o conteúdo de login
// (botões, textos, rodapé) sem precisar mexer no z-index de mais nada.
function injectCSS() {
    if (document.getElementById('authsky-css')) return;
    const css = `
        #authSkyboxLayer {
            position: absolute;
            inset: 0;
            overflow: hidden;
            z-index: -1;
            pointer-events: none;
            background: #0d1a0d;
        }
        #authSkyboxCanvas {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            display: block;
        }
    `;
    const s = document.createElement('style');
    s.id = 'authsky-css';
    s.textContent = css;
    document.head.appendChild(s);
}

function buildDom() {
    let layer = document.getElementById('authSkyboxLayer');
    if (layer) return layer;
    const authContainer = document.getElementById('authContainer');
    if (!authContainer) return null;
    injectCSS();
    layer = document.createElement('div');
    layer.id = 'authSkyboxLayer';
    const canvas = document.createElement('canvas');
    canvas.id = 'authSkyboxCanvas';
    layer.appendChild(canvas);
    authContainer.insertBefore(layer, authContainer.firstChild);
    return layer;
}

// ═══════════════════════════════════════════════════════════════════════
// TEXTURA DO BRILHO DE FOGO (gerada em canvas — sem depender de asset) ──
// Um gradiente radial quente com blending ADITIVO: fica "queimando" por
// cima de qualquer coisa atrás dele, garantindo o efeito de brasa/fogo na
// boca do dragão independentemente do bloom genérico da cena.
// ═══════════════════════════════════════════════════════════════════════
function getGlowTexture() {
    if (_glowTexture) return _glowTexture;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0,    'rgba(255,248,214,1)');
    grad.addColorStop(0.30, 'rgba(255,190,90,0.95)');
    grad.addColorStop(0.62, 'rgba(255,110,30,0.45)');
    grad.addColorStop(1,    'rgba(255,60,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    _glowTexture = new THREE.CanvasTexture(canvas);
    _glowTexture.needsUpdate = true;
    return _glowTexture;
}

// ═══════════════════════════════════════════════════════════════════════
// DRAGÕES — sprite billboard com espelhamento por textura
// ═══════════════════════════════════════════════════════════════════════
// IMPORTANTE (mesma observação da Floresta Mística): THREE.Sprite ignora
// o SINAL da escala (sprite.scale.x = -1 não espelha nada). O espelhamento
// precisa ser feito trocando a textura por uma cópia com repeat.x = -1.
// Aqui: dragão voando pra DIREITA usa a textura ORIGINAL (a arte já olha
// pra direita); dragão voando pra ESQUERDA usa a versão ESPELHADA.
function getDragonTexture(flip) {
    return flip ? _dragonTexCache.flipped : _dragonTexCache.base;
}

function loadDragonTextures(onReady) {
    if (_dragonTexCache.base) { onReady(); return; }
    new THREE.TextureLoader().load(
        DRAGON_IMAGE_URL,
        (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            _dragonTexCache.base = tex;

            const flipped = tex.clone();
            flipped.wrapS = THREE.RepeatWrapping;
            flipped.repeat.x = -1;
            flipped.offset.x = 1;
            flipped.needsUpdate = true;
            _dragonTexCache.flipped = flipped;

            onReady();
        },
        undefined,
        (err) => console.error('[AuthSkybox] Falha ao carregar a textura do dragão:', err)
    );
}

// Sorteia uma altura (NDC Y) pro próximo voo, respeitando distância
// mínima em relação ao OUTRO dragão (se ele estiver voando agora). Isso é
// o que garante que os dois nunca "passam um por dentro do outro".
function pickDragonY(excludeId) {
    const other = _dragons.find((d) => d.id !== excludeId);
    const otherActive = other && other.sprite.visible;

    if (!otherActive) {
        return randBetween(DRAGON_Y_MIN, DRAGON_Y_MAX);
    }
    for (let i = 0; i < 8; i++) {
        const y = randBetween(DRAGON_Y_MIN, DRAGON_Y_MAX);
        if (Math.abs(y - other.ndcY) >= DRAGON_MIN_Y_GAP) return y;
    }
    // Não achou uma altura livre por sorteio — empurra pro extremo oposto
    // do intervalo, o mais longe possível do outro dragão.
    const mid = (DRAGON_Y_MIN + DRAGON_Y_MAX) / 2;
    return other.ndcY < mid ? DRAGON_Y_MAX : DRAGON_Y_MIN;
}

function createDragonEntry(profile) {
    const tex = getDragonTexture(profile.flip);
    const aspect = _dragonTexCache.base.image.width / _dragonTexCache.base.image.height;
    const fovRad = THREE.MathUtils.degToRad(CAM_FOV);
    const worldHeight = 2 * DRAGON_REF_DISTANCE * Math.tan(fovRad / 2) * DRAGON_HEIGHT_FRAC;
    const worldWidth = worldHeight * aspect;

    const material = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(worldWidth, worldHeight, 1);
    sprite.renderOrder = 5;
    sprite.visible = false;
    _sky.scene.add(sprite);

    const glowMaterial = new THREE.SpriteMaterial({
        map: getGlowTexture(),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0.8,
    });
    const glowSprite = new THREE.Sprite(glowMaterial);
    const glowSize = worldHeight * MOUTH_GLOW_SIZE_FRAC;
    glowSprite.scale.set(glowSize, glowSize, 1);
    glowSprite.renderOrder = 6; // acima do próprio dragão
    glowSprite.visible = false;
    _sky.scene.add(glowSprite);

    // Deslocamento local (em unidades de mundo) do centro do dragão até a
    // boca. Espelha o eixo X junto com a textura, senão o brilho fica do
    // lado errado quando o dragão está voando pra esquerda.
    const mouthLocalX = (MOUTH_FRAC_X - 0.5) * worldWidth * (profile.flip ? -1 : 1);
    const mouthLocalY = (0.5 - MOUTH_FRAC_Y) * worldHeight;

    return {
        id: profile.id,
        profile,
        sprite,
        material,
        glowSprite,
        glowMaterial,
        worldWidth,
        worldHeight,
        mouthLocalX,
        mouthLocalY,
        glowPhase: Math.random() * Math.PI * 2, // fase aleatória — os dois brilhos não "piscam" em sincronia
        ndcX: profile.startNdcX,
        ndcY: DRAGON_Y_MIN,
        flightDistance: DRAGON_REF_DISTANCE,
        flightStartTs: 0,
        tween: null,
        timeout: null,
    };
}

function createDragons() {
    loadDragonTextures(() => {
        if (!_sky) return; // a tela de login já foi fechada antes da imagem terminar de carregar
        _dragons = DRAGON_PROFILES.map(createDragonEntry);
        for (const dragon of _dragons) {
            scheduleDragonFlight(dragon, randBetween(DRAGON_FIRST_DELAY_MIN, DRAGON_FIRST_DELAY_MAX));
        }
    });
}

function scheduleDragonFlight(dragon, delayMs) {
    dragon.timeout = setTimeout(() => startDragonFlight(dragon), delayMs);
}

function startDragonFlight(dragon) {
    if (!_sky || !_sky.running) return;
    dragon.ndcX = dragon.profile.startNdcX;
    dragon.ndcY = pickDragonY(dragon.id);
    dragon.flightDistance = randBetween(DRAGON_DIST_MIN, DRAGON_DIST_MAX);
    dragon.flightStartTs = performance.now();
    dragon.sprite.visible = true;
    dragon.glowSprite.visible = true;

    const flightMs = randBetween(DRAGON_FLIGHT_MS_MIN, DRAGON_FLIGHT_MS_MAX);
    const state = { x: dragon.profile.startNdcX };
    dragon.tween = new TWEEN.Tween(state)
        .to({ x: dragon.profile.endNdcX }, flightMs)
        // Sinusoidal.InOut: entra e sai de tela suavemente, com um leve
        // "pico" de velocidade no meio do trajeto — planar, não deslizar.
        .easing(TWEEN.Easing.Sinusoidal.InOut)
        .onUpdate(() => { dragon.ndcX = state.x; })
        .onComplete(() => {
            dragon.sprite.visible = false;
            dragon.glowSprite.visible = false;
            scheduleDragonFlight(dragon, randBetween(DRAGON_PAUSE_MS_MIN, DRAGON_PAUSE_MS_MAX));
        })
        .start();
}

// Recalcula a posição de um dragão a cada frame projetando uma coordenada
// de TELA (NDC) de volta pro mundo 3D através da câmera ATUAL — por isso
// o caminho fica sempre "colado" na tela, mesmo com a câmera girando
// sozinha por trás.
const _ndcScratch = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _camUp = new THREE.Vector3();
function updateDragonsVisual(ts) {
    if (!_dragons.length) return;
    _camRight.setFromMatrixColumn(_sky.camera.matrixWorld, 0);
    _camUp.setFromMatrixColumn(_sky.camera.matrixWorld, 1);

    for (const dragon of _dragons) {
        if (!dragon.sprite.visible) continue;
        const elapsedSec = (ts - dragon.flightStartTs) / 1000;
        const bob = Math.sin(elapsedSec * DRAGON_BOB_FREQ_HZ * Math.PI * 2) * DRAGON_BOB_AMPL;

        _ndcScratch.set(dragon.ndcX, dragon.ndcY + bob, 0.5);
        _ndcScratch.unproject(_sky.camera);
        const dir = _ndcScratch.sub(_sky.camera.position).normalize();
        const worldPos = _sky.camera.position.clone().addScaledVector(dir, dragon.flightDistance);

        dragon.sprite.position.copy(worldPos);
        dragon.material.rotation = Math.sin(elapsedSec * 2.1) * DRAGON_TILT_AMPL_RAD;

        // Brilho da boca: acompanha o dragão, deslocado pelos vetores
        // direita/cima DA CÂMERA (não do mundo) — assim ele fica sempre
        // "grudado" na boca do sprite billboard, que sempre encara a
        // câmera. Um flicker rápido (~9Hz, com fase própria) simula o
        // fogo tremulando, como se estivesse prestes a cuspir uma
        // labareda.
        const flicker = 0.7 + 0.3 * Math.sin(elapsedSec * 9 + dragon.glowPhase)
                             + 0.12 * Math.sin(elapsedSec * 23 + dragon.glowPhase * 1.7);
        const glowWorldPos = worldPos.clone()
            .addScaledVector(_camRight, dragon.mouthLocalX)
            .addScaledVector(_camUp, dragon.mouthLocalY);
        dragon.glowSprite.position.copy(glowWorldPos);
        const glowScale = dragon.worldHeight * MOUTH_GLOW_SIZE_FRAC * (0.8 + 0.25 * flicker);
        dragon.glowSprite.scale.set(glowScale, glowScale, 1);
        dragon.glowMaterial.opacity = 0.5 + 0.4 * flicker;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// CICLO DE VIDA — só existe enquanto a tela de login estiver visível
// ═══════════════════════════════════════════════════════════════════════
function loop(ts) {
    if (!_sky || !_sky.running) return;
    const dt = Math.min(ts - _lastTs, 100);
    _lastTs = ts;

    _camYaw += ROTATE_DEG_PER_SEC * (dt / 1000);
    updateCameraLook();
    _sky.camera.updateMatrixWorld(true); // necessário ANTES do unproject dos dragões

    TWEEN.update(ts);
    updateDragonsVisual(ts);

    if (_sky.pfx) {
        try {
            _sky.pfx.render(_sky.scene, _sky.camera);
        } catch (e) {
            console.error('[AuthSkybox] Erro ao renderizar com pós-processamento, desativando:', e);
            _sky.pfx = null;
            _sky.renderer.render(_sky.scene, _sky.camera);
        }
    } else {
        _sky.renderer.render(_sky.scene, _sky.camera);
    }

    _sky.raf = requestAnimationFrame(loop);
}

function startAuthSkybox() {
    if (_sky) return; // já rodando
    const cont = buildDom();
    if (!cont) return;
    const canvas = document.getElementById('authSkyboxCanvas');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAM_FOV, cont.clientWidth / Math.max(cont.clientHeight, 1), 0.1, 1000);
    camera.position.set(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(cont.clientWidth, cont.clientHeight);

    // Esfera "por dentro" — igual à Floresta Mística.
    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0x0d1a0d });
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    new THREE.TextureLoader().load(
        SKY_IMAGE_URL,
        (tex) => {
            if (!_sky) return; // tela fechada antes de a imagem carregar
            tex.colorSpace = THREE.SRGBColorSpace;
            material.map = tex;
            material.color.set(0xffffff);
            material.needsUpdate = true;
        },
        undefined,
        (err) => console.error('[AuthSkybox] Falha ao carregar a imagem do skybox:', err)
    );

    _camYaw = 0; // sempre reinicia o giro do zero a cada vez que a tela de login aparece
    _sky = { scene, camera, renderer, canvas, cont, running: true, raf: 0, pfx: null, _onResize: null };

    // ── Ajuste de bloom SÓ PARA ESTA PÁGINA ──────────────────────────────
    // O postfx.js é compartilhado com outras telas (Floresta Mística
    // etc.) e continua intocado no arquivo; aqui só sobrescrevemos, em
    // memória, os números que a PRÓPRIA instância deste módulo carregada
    // por esta página vai usar ao montar o UnrealBloomPass logo abaixo.
    // Isso NÃO afeta nenhuma outra tela do jogo (cada página carrega sua
    // própria cópia do postfx.js). O threshold padrão (0.72) foi calibrado
    // pra cenas de interior da Floresta e só pegava o sol nesta imagem —
    // baixando ele, os raios do céu (e o fogo do dragão) também brilham.
    POSTFX_CONFIG.bloom.threshold = 0.42;
    POSTFX_CONFIG.bloom.strength  = 0.9;
    POSTFX_CONFIG.bloom.radius    = 0.65;

    try {
        _sky.pfx = initPostFX({ scene, camera, renderer, cont });
    } catch (e) {
        console.error('[AuthSkybox] Falha ao iniciar pós-processamento, usando renderização padrão:', e);
        _sky.pfx = null;
    }

    updateCameraLook();
    camera.updateMatrixWorld(true);

    function onResize() {
        if (!_sky) return;
        const w = cont.clientWidth, h = cont.clientHeight;
        camera.aspect = w / Math.max(h, 1);
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        if (_sky.pfx) {
            try { _sky.pfx.resize(w, h); } catch (e) { console.error('[AuthSkybox] Erro no resize:', e); }
        }
    }
    _sky._onResize = onResize;
    window.addEventListener('resize', onResize);

    createDragons();

    _lastTs = performance.now();
    _sky.raf = requestAnimationFrame(loop);
}

function stopAuthSkybox() {
    if (!_sky) return;
    _sky.running = false;
    if (_sky.raf) cancelAnimationFrame(_sky.raf);
    if (_sky._onResize) window.removeEventListener('resize', _sky._onResize);

    for (const dragon of _dragons) {
        if (dragon.timeout) clearTimeout(dragon.timeout);
        if (dragon.tween) dragon.tween.stop();
    }

    try {
        _sky.scene.traverse((obj) => {
            if (obj.material) {
                if (obj.material.map) obj.material.map.dispose();
                obj.material.dispose();
            }
            if (obj.geometry) obj.geometry.dispose();
        });
        _sky.renderer.dispose();
    } catch (e) {
        console.error('[AuthSkybox] Erro ao liberar recursos do skybox:', e);
    }

    const layer = document.getElementById('authSkyboxLayer');
    if (layer) layer.remove();

    _dragonTexCache.base = null;
    _dragonTexCache.flipped = null;
    _glowTexture = null;
    _dragons = [];
    _sky = null;
}

// ── Controle de visibilidade: só roda com a tela de login visível ───────
// Dois gatilhos combinados, pra nunca pesar no dispositivo do jogador:
//   1) #authContainer sai/entra de "display:none" (login concluído/aberto);
//   2) a ABA/JANELA fica oculta (visibilitychange do navegador).
function isAuthScreenVisible() {
    const el = document.getElementById('authContainer');
    return !!el && window.getComputedStyle(el).display !== 'none';
}

function evaluateVisibility() {
    const shouldRun = isAuthScreenVisible() && !document.hidden;
    if (shouldRun && !_sky) startAuthSkybox();
    else if (!shouldRun && _sky) stopAuthSkybox();
}

function attachVisibilityWatcher() {
    const el = document.getElementById('authContainer');
    if (!el) { setTimeout(attachVisibilityWatcher, 300); return; }
    const observer = new MutationObserver(evaluateVisibility);
    observer.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    document.addEventListener('visibilitychange', evaluateVisibility);
    evaluateVisibility();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachVisibilityWatcher);
} else {
    attachVisibilityWatcher();
}
