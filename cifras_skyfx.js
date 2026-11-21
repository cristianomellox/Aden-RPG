// ═══════════════════════════════════════════════════════════════════════
// CIFRAS — EFEITOS DO SKYBOX (three.js + tween.js)
// Importado por cifras_skybox.js (best effort: se falhar, o skybox segue normal).
// Entra na MESMA cena/câmera do panorama, então gira junto com o céu e passa pelo
// mesmo pós-processamento (bloom do postfx.js).
//
//  • Holofotes volumétricos que varrem o céu (cones aditivos com borda suave)
//  • Poeira de luz dourada subindo (Points)
//  • Véu celestial: cortinas de luz dourado/violeta/ciano na parte alta do céu
//  • Estrelas cadentes ocasionais (tween.js)
//
// Ajuste tudo em CFG. Intensidade geral: CFG.intensity (0 desliga visualmente).
// ═══════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';

const CFG = {
    intensity: 1.0,          // multiplicador geral (0.5 = mais discreto, 1.5 = mais forte)
    beams: 12,               // quantidade de holofotes ao redor dos 360°
    radius: 420,             // distância da base dos holofotes até a câmera
    rootElevDeg: -42,        // altura da base (negativo = abaixo do horizonte)
    length: 760,
    rBottom: 3, rTop: 70,    // abertura do cone
    motes: 520,              // partículas de poeira de luz
    aurora: 0.30,            // força do véu celestial (0 desliga)
    shootingStars: true,
    palette: [               // dourado, branco quente, azul celestial, âmbar, violeta, creme
        [1.00, 0.80, 0.38], [0.95, 0.97, 1.00], [0.45, 0.65, 1.00],
        [1.00, 0.72, 0.30], [0.72, 0.55, 1.00], [1.00, 0.90, 0.70],
    ],
};

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a, b) => a + Math.random() * (b - a);
const D2R = Math.PI / 180;

// ── Shaders ───────────────────────────────────────────────────────────
const BEAM_VS = `
uniform float uLen;
varying vec3 vN; varying vec3 vW; varying float vH;
void main(){
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vH = position.y / uLen;
    gl_Position = projectionMatrix * viewMatrix * w;
}`;
const BEAM_FS = `
uniform vec3 uC; uniform float uI, uT, uPh;
varying vec3 vN; varying vec3 vW; varying float vH;
void main(){
    vec3 V = normalize(cameraPosition - vW);
    float f = abs(dot(normalize(vN), V));
    float edge = pow(f, 1.5);
    float along = smoothstep(0.0, 0.07, vH) * pow(max(1.0 - vH, 0.0), 1.15);
    float shimmer = 0.82 + 0.18 * sin(vH * 26.0 - uT * 1.2 + uPh);
    float a = uI * edge * along * shimmer;
    gl_FragColor = vec4(uC, a);
}`;

const MOTE_VS = `
attribute vec4 aR; uniform float uT, uPx; varying float vA; varying vec3 vC;
void main(){
    vec3 p = position;
    p.y = mod(p.y + uT * aR.y * 8.0 + 300.0, 600.0) - 300.0;
    p.x += sin(uT * 0.2 + aR.x * 6.2831) * 6.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(aR.z * uPx * (300.0 / max(-mv.z, 1.0)), 48.0);
    vA = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uT * aR.w + aR.x * 40.0), 3.0);
    vC = mix(vec3(1.0, 0.82, 0.45), vec3(0.85, 0.92, 1.0), step(0.7, fract(aR.x * 7.0)));
}`;
const MOTE_FS = `
uniform float uAl; varying float vA; varying vec3 vC;
void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = 1.0 - smoothstep(0.0, 0.5, d);
    a *= a;
    gl_FragColor = vec4(vC, a * vA * uAl);
}`;

const AURORA_VS = `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const AURORA_FS = `
uniform float uT, uI; varying vec3 vD;
void main(){
    vec3 d = normalize(vD);
    float az = atan(d.x, d.z);
    float el = asin(clamp(d.y, -1.0, 1.0));
    float band = smoothstep(0.10, 0.45, el) * (1.0 - smoothstep(0.95, 1.40, el));
    float c1 = sin(az * 3.0 + uT * 0.08 + sin(az * 7.0 - uT * 0.13 + el * 4.0) * 1.4);
    float c2 = sin(az * 5.0 - uT * 0.06 + sin(az * 11.0 + uT * 0.10) * 1.1 + el * 2.0);
    float cur = pow(0.5 + 0.5 * c1, 3.0) * 0.6 + pow(0.5 + 0.5 * c2, 4.0) * 0.4;
    float streak = pow(0.5 + 0.5 * sin(el * 22.0 + sin(az * 4.0 + uT * 0.2) * 2.0), 6.0) * 0.5 + 0.5;
    vec3 gold = vec3(1.0, 0.78, 0.35), vio = vec3(0.55, 0.45, 1.0), cy = vec3(0.4, 0.8, 1.0);
    vec3 col = mix(gold, mix(vio, cy, 0.5 + 0.5 * sin(az * 2.0 + uT * 0.05)), smoothstep(0.2, 0.9, el));
    float a = cur * band * streak * uI;
    gl_FragColor = vec4(col, a);
}`;

const STAR_FS = `
varying vec2 vUv; uniform float uA;
void main(){
    float x = vUv.x, y = abs(vUv.y - 0.5) * 2.0;
    float w = (1.0 - y); w *= w;
    float tail = pow(x, 3.0) * w;
    float head = smoothstep(0.88, 1.0, x) * (1.0 - smoothstep(0.0, 1.0, y)) * 1.6;
    gl_FragColor = vec4(vec3(1.0, 0.95, 0.8), (tail + head) * uA);
}`;
const STAR_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function additive(extra) {
    return Object.assign({
        transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.AdditiveBlending,
    }, extra);
}

function glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

// ── API ───────────────────────────────────────────────────────────────
export function initSkyFX({ scene, camera, renderer }) {
    const root = new THREE.Group();
    root.name = 'CifrasSkyFX';
    scene.add(root);
    const px = Math.min(renderer.getPixelRatio ? renderer.getPixelRatio() : 1, 2);

    // 1) Holofotes
    const beamGeo = new THREE.CylinderGeometry(CFG.rTop, CFG.rBottom, CFG.length, 32, 1, true);
    beamGeo.translate(0, CFG.length / 2, 0);   // base na origem, cone abre para +Y
    const glowTex = glowTexture();
    const beams = [];
    const elev = CFG.rootElevDeg * D2R;
    const Rh = CFG.radius * Math.cos(elev), y0 = CFG.radius * Math.sin(elev);
    for (let i = 0; i < CFG.beams; i++) {
        const az = (i / CFG.beams) * Math.PI * 2 + rand(-0.1, 0.1);
        const c = CFG.palette[i % CFG.palette.length];
        const mat = new THREE.ShaderMaterial(additive({
            uniforms: {
                uC: { value: new THREE.Color().setRGB(c[0], c[1], c[2]) },
                uI: { value: 0.3 }, uT: { value: 0 }, uPh: { value: rand(0, 6.28) }, uLen: { value: CFG.length },
            },
            vertexShader: BEAM_VS, fragmentShader: BEAM_FS, side: THREE.DoubleSide,
        }));
        const holder = new THREE.Group();
        holder.position.set(Math.sin(az) * Rh, y0, Math.cos(az) * Rh);
        holder.rotation.y = az;                      // +Z local = radial para fora
        const mesh = new THREE.Mesh(beamGeo, mat);
        mesh.renderOrder = 10;
        mesh.frustumCulled = false;
        holder.add(mesh);
        const spr = new THREE.Sprite(new THREE.SpriteMaterial(additive({
            map: glowTex, color: mat.uniforms.uC.value, opacity: 0.6,
        })));
        spr.scale.setScalar(110);
        spr.renderOrder = 11;
        holder.add(spr);
        root.add(holder);
        beams.push({
            mesh, mat, spr,
            rx0: rand(-0.22, 0.22), rz0: rand(-0.22, 0.22),
            ax: rand(0.18, 0.42), az: rand(0.18, 0.42),
            sx: rand(0.16, 0.40), sz: rand(0.14, 0.36), sp: rand(0.25, 0.6), ph: rand(0, 6.28),
        });
    }

    // 2) Poeira de luz
    const n = CFG.motes;
    const pos = new Float32Array(n * 3), aR = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
        const u = Math.random() * Math.PI * 2, v = Math.acos(2 * Math.random() - 1), r = rand(90, 400);
        pos[i * 3] = r * Math.sin(v) * Math.sin(u);
        pos[i * 3 + 1] = r * Math.cos(v) * 0.9;
        pos[i * 3 + 2] = r * Math.sin(v) * Math.cos(u);
        aR[i * 4] = Math.random(); aR[i * 4 + 1] = rand(0.3, 1.2); aR[i * 4 + 2] = rand(3, 9); aR[i * 4 + 3] = rand(0.6, 2.2);
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    mg.setAttribute('aR', new THREE.BufferAttribute(aR, 4));
    const motes = new THREE.Points(mg, new THREE.ShaderMaterial(additive({
        uniforms: { uT: { value: 0 }, uPx: { value: px }, uAl: { value: 0.55 * CFG.intensity } },
        vertexShader: MOTE_VS, fragmentShader: MOTE_FS,
    })));
    motes.frustumCulled = false;
    motes.renderOrder = 12;
    root.add(motes);

    // 3) Véu celestial
    let aurora = null;
    if (CFG.aurora > 0) {
        aurora = new THREE.Mesh(new THREE.SphereGeometry(470, 48, 32), new THREE.ShaderMaterial(additive({
            uniforms: { uT: { value: 0 }, uI: { value: CFG.aurora * CFG.intensity } },
            vertexShader: AURORA_VS, fragmentShader: AURORA_FS, side: THREE.BackSide,
        })));
        aurora.renderOrder = 9;
        aurora.frustumCulled = false;
        root.add(aurora);
    }

    // 4) Estrelas cadentes (tween.js)
    const stars = [];
    if (CFG.shootingStars && !REDUCED) {
        const sg = new THREE.PlaneGeometry(1, 1);
        for (let i = 0; i < 3; i++) {
            const m = new THREE.Mesh(sg, new THREE.ShaderMaterial(additive({
                uniforms: { uA: { value: 0 } }, vertexShader: STAR_VS, fragmentShader: STAR_FS, side: THREE.DoubleSide,
            })));
            m.visible = false; m.renderOrder = 13; m.frustumCulled = false;
            root.add(m); stars.push(m);
        }
    }
    function spawnStar(yawDeg) {
        const m = stars.find((s) => !s.visible);
        if (!m) return;
        const az = (yawDeg + rand(-45, 45)) * D2R, el = rand(16, 46) * D2R, R = 440;
        m.position.set(Math.sin(az) * Math.cos(el) * R, Math.sin(el) * R, Math.cos(az) * Math.cos(el) * R);
        m.rotation.set(0, 0, 0);
        m.lookAt(0, 0, 0);
        m.rotateZ(-Math.PI / 2 + rand(-0.9, 0.9));
        m.scale.set(rand(70, 120), rand(1.4, 2.2), 1);
        const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(m.quaternion);
        const p0 = m.position.clone(), dist = rand(110, 170);
        m.visible = true;
        new TWEEN.Tween({ k: 0 })
            .to({ k: 1 }, rand(800, 1300))
            .easing(TWEEN.Easing.Quadratic.Out)
            .onUpdate((o) => {
                m.position.copy(p0).addScaledVector(dir, o.k * dist);
                m.material.uniforms.uA.value = Math.sin(Math.PI * o.k) * CFG.intensity;
            })
            .onComplete(() => { m.visible = false; })
            .start();
    }

    let nextStar = 3;
    function update(t, dt, yawDeg) {
        const mt = REDUCED ? 0 : t;
        const breath = 0.75 + 0.25 * Math.sin(mt * 0.23);
        for (const b of beams) {
            b.mesh.rotation.x = b.rx0 + Math.sin(mt * b.sx + b.ph) * b.ax;
            b.mesh.rotation.z = b.rz0 + Math.sin(mt * b.sz + b.ph * 1.7) * b.az;
            const pulse = 0.55 + 0.45 * Math.sin(mt * b.sp + b.ph * 2.1);
            b.mat.uniforms.uI.value = CFG.intensity * 0.34 * pulse * breath;
            b.mat.uniforms.uT.value = t;
            b.spr.material.opacity = (0.25 + 0.45 * pulse) * Math.min(CFG.intensity, 1.5);
        }
        motes.material.uniforms.uT.value = t;
        if (aurora) aurora.material.uniforms.uT.value = t;
        if (stars.length && t > nextStar) { spawnStar(yawDeg || 0); nextStar = t + rand(6, 13); }
    }

    return {
        update,
        group: root,
        setIntensity(v) {
            CFG.intensity = v;
            motes.material.uniforms.uAl.value = 0.55 * v;
            if (aurora) aurora.material.uniforms.uI.value = CFG.aurora * v;
        },
        setVisible(v) { root.visible = !!v; },
    };
}
