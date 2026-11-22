// ═══════════════════════════════════════════════════════════════════════
// CIFRAS — EFEITOS 3D (three.js + tween.js)
//
//  1) (o HALO CELESTIAL da logo agora vive em cifras_skyfx.js, dentro do renderer do skybox)
//
//  PALCO ÉPICO da tela da música (atrás da letra e das cifras): um grande palco
//     escuro com holofotes móveis, portal de luz com uma cruz em silhueta, círculo
//     de runas no chão, neblina, brasas douradas (sem bloom).
//     O palco REAGE À MÚSICA: lê as seções da cifra ([Refrão], [Ponte]…) e a posição
//     da rolagem. Verso = luz calma e azulada; Refrão = holofotes abertos, dourado,
//     onda de choque. Ao abrir outra música, "abre a cortina".
//
// IMPORTANTE: o navegador só aguenta ~16 contextos WebGL por página e derruba o MAIS ANTIGO quando passa
// disso (era o que apagava o skybox, a logo 3D e ícones). Por isso o palco NÃO cria contexto próprio:
// empresta o renderer do skybox (que fica pausado fora da tela inicial) via CifrasSkybox.borrow().
// Só se o skybox não existir é que cria um renderer próprio (fallback).
//
// Nada aqui bloqueia o app: sem WebGL / sem rede para o three.js, simplesmente não aparece.
// Botão ✦ (canto esquerdo da tela da música) alterna: Épico → Suave → Desligado.
// ═══════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';

const BODY = document.body;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const $ = (s) => document.querySelector(s);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* modo privado */ } },
};

// Funções GLSL comuns (ruído, linha suave com anti-alias por derivada)
const GLSL = `
#define TAU 6.28318530718
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+vec2(1.,1.)),f.x),f.y);}
float fbm2(vec2 p){return vnoise(p)*.62+vnoise(p*2.13+3.7)*.38;}
float lineG(float d,float w){float aa=fwidth(d);float s=sqrt(w*w+aa*aa);return exp(-d*d/(s*s))*w/s;}
`;
const addMat = (o) => Object.assign({ transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }, o);

// ═══════════════════════════════════════════════════════════════════════
// 2) PALCO ÉPICO DA TELA DA MÚSICA
// ═══════════════════════════════════════════════════════════════════════
// Brilho geral do palco (0.4 = bem discreto · 0.7 = padrão · 1.0 = forte). Pode ajustar ao vivo: CifrasStage.setGain(0.5)
let STAGE_GAIN = 0.7;
const QUAL = {
    epic: { scale: MOBILE ? 0.75 : 1.0, beams: 10, parts: 900, bokeh: 40, haze: true, fps: 60 },
    soft: { scale: 0.55, beams: 6, parts: 350, bokeh: 0, haze: false, fps: 30 },
};

function injectStageDom() {
    const css = document.createElement('style');
    css.textContent = `
#songStage,#songVeil{position:fixed;inset:0;pointer-events:none;display:none}
#songStage{z-index:0;background:#02030a}   /* só usado no fallback (sem skybox) */
#songVeil{z-index:1;background:
  linear-gradient(to bottom,rgba(0,0,0,.40),rgba(0,0,0,.26) 28%,rgba(0,0,0,.26) 66%,rgba(0,0,0,.58)),
  linear-gradient(90deg,rgba(0,0,0,.18),rgba(0,0,0,.50) calc(50% - 400px),rgba(0,0,0,.50) calc(50% + 400px),rgba(0,0,0,.18))}
#songStage canvas{width:100%;height:100%;display:block}
body.onsong #songVeil,body.onsong #songStage.fb{display:block}
body.onsong.stage-soft #songVeil{background:rgba(0,0,0,.62)}
body.stage-off #songStage,body.stage-off #songVeil{display:none!important}
body.onsong:not(.stage-off) #song .sheet{text-shadow:0 1px 2px #000,0 0 12px rgba(0,0,0,.9)}
body.onsong:not(.stage-off) #song .sheet .chord{text-shadow:0 1px 3px #000,0 0 10px #000}
#stageBtn{position:fixed;left:12px;top:calc(env(safe-area-inset-top,0px) + 120px);z-index:16;width:42px;height:42px;padding:0;border-radius:50%;background:rgba(0,0,0,.72);border:1px solid var(--gold);color:var(--gold);display:none;place-items:center;box-shadow:0 2px 10px rgba(0,0,0,.7)}
body.onsong #stageBtn{display:grid}
#stageBtn svg{width:22px;height:22px}
#stageTip{position:fixed;left:62px;top:calc(env(safe-area-inset-top,0px) + 129px);z-index:16;padding:5px 10px;border-radius:10px;background:rgba(0,0,0,.82);border:1px solid var(--gold);color:var(--gold);font:700 .78rem system-ui,sans-serif;opacity:0;transition:opacity .25s;pointer-events:none;white-space:nowrap}
#stageTip.on{opacity:1}`;
    document.head.appendChild(css);

    const stage = document.createElement('div');
    stage.id = 'songStage'; stage.setAttribute('aria-hidden', 'true');
    const veil = document.createElement('div');
    veil.id = 'songVeil'; veil.setAttribute('aria-hidden', 'true');
    BODY.insertBefore(veil, BODY.firstChild);
    BODY.insertBefore(stage, veil);

    const btn = document.createElement('button');
    btn.id = 'stageBtn'; btn.type = 'button'; btn.setAttribute('aria-label', 'Efeito de palco');
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
    const tip = document.createElement('div');
    tip.id = 'stageTip';
    BODY.append(btn, tip);
    return { host: stage, btn, tip };
}

// Renderer do palco: o do skybox (emprestado) ou, sem skybox, um próprio.
let ownR = null;
function getRenderer(host) {
    const SB = window.CifrasSkybox;
    if (SB && SB.isReady && SB.isReady()) return SB.isFlat() ? null : SB.getRenderer();   // null = recuperando contexto
    if (ownR === null) {
        try {
            const c = document.createElement('canvas');
            c.style.cssText = 'width:100%;height:100%;display:block';
            host.appendChild(c);
            ownR = new THREE.WebGLRenderer({ canvas: c, antialias: false, powerPreference: 'high-performance' });
        } catch (e) { console.warn('[CifrasStage] WebGL indisponível', e); ownR = false; }
    }
    return ownR || null;
}

async function buildStage(host) {
    let R = null, saved = null;
    // Aplica as configurações do palco no renderer emprestado (guardando as do skybox para devolver depois).
    // Todas as cores do palco já são "de tela": sem conversão extra no final.
    function adopt(r) {
        if (R === r) return;
        R = r;
        saved = { pr: r.getPixelRatio(), cs: r.outputColorSpace, tm: r.toneMapping, ac: r.autoClear, ca: r.getClearAlpha(), cc: r.getClearColor(new THREE.Color()).clone() };
        r.outputColorSpace = THREE.LinearSRGBColorSpace;
        r.toneMapping = THREE.NoToneMapping;
        r.autoClear = true;
        r.setClearColor(0x000000, 1);
        resize();
    }
    function giveBack() {
        if (R && saved) {
            try {
                R.outputColorSpace = saved.cs; R.toneMapping = saved.tm; R.autoClear = saved.ac;
                R.setClearColor(saved.cc, saved.ca); R.setPixelRatio(saved.pr);
            } catch (e) { /* renderer já foi trocado/perdido */ }
        }
        R = null; saved = null;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color().setRGB(0.004, 0.005, 0.016);
    const cam = new THREE.PerspectiveCamera(52, 1, 0.1, 260);
    const G = new TWEEN.Group();

    // Uniforms compartilhados (um único objeto por valor: atualiza uma vez, todos os materiais veem)
    const U = {
        uT: { value: 0 }, uE: { value: 0.4 }, uWarm: { value: 0 }, uMaster: { value: 0 },
        uBurst: { value: 0 }, uWave: { value: 1 }, uPx: { value: 1 },
    };
    const wave = U.uWave, flash = U.uBurst, master = U.uMaster;

    // ── Portal de luz com cruz em silhueta ───────────────────────────
    const PORTAL_Y = 13;
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(96, 62), new THREE.ShaderMaterial(addMat({
        uniforms: { uT: U.uT, uE: U.uE, uWarm: U.uWarm, uMaster: U.uMaster, uBurst: U.uBurst },
        vertexShader: 'varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
        fragmentShader: GLSL + `
uniform float uT,uE,uWarm,uMaster,uBurst; varying vec3 vW;
float sdBox(vec2 p,vec2 c,vec2 h){vec2 d=abs(p-c)-h;return length(max(d,0.))+min(max(d.x,d.y),0.);}
void main(){
    vec2 p=vW.xy-vec2(0.,${PORTAL_Y}.);
    float r=length(p), a=atan(p.y,p.x);
    vec3 warm=mix(vec3(.55,.72,1.),vec3(1.,.78,.38),uWarm);
    float en=.30+.38*uE+uBurst*.45;
    float core=exp(-r*r*.028)*1.0;
    float halo=exp(-r*.11)*.32;
    float rays=pow(.5+.5*sin(a*16.+uT*.09+sin(a*3.-uT*.05)*1.6),4.)*exp(-r*.050)*smoothstep(1.,7.,r)*.65;
    float arches=0.;
    for(int i=0;i<3;i++){float Rr=9.5+float(i)*5.8; arches+=exp(-pow((r-Rr)*1.25,2.))*(.55-.12*float(i));}
    arches*=.45+.55*pow(.5+.5*sin(a*5.+uT*.25),2.);
    float cr=min(sdBox(p,vec2(0.,-1.),vec2(.42,9.8)),sdBox(p,vec2(0.,3.6),vec2(3.8,.42)));
    float inCross=1.-smoothstep(-.12,.12,cr);
    float L=(core+halo)*(1.-.94*inCross);
    L+=rays*(1.-.8*inCross);
    L+=arches*.6;
    L+=exp(-max(cr,0.)*14.)*.40*(core+.25);
    L*=en*uMaster;
    vec3 col=mix(warm,vec3(1.,.97,.9),clamp(core*.45,0.,1.));
    float fe=(1.-smoothstep(22.,44.,abs(p.x)))*(1.-smoothstep(14.,29.,abs(p.y)));
    gl_FragColor=vec4(col*L*fe,1.);
}`,
    })));
    portal.position.set(0, PORTAL_Y, -36);
    portal.renderOrder = 1;
    scene.add(portal);

    // ── Chão: palco com círculo de runas, grade, poças de luz e onda de choque ──
    const NB = 10;
    const pool = Array.from({ length: NB }, () => new THREE.Vector3(0, 0, 1));
    const poolC = Array.from({ length: NB }, () => new THREE.Vector3());
    const poolI = new Array(NB).fill(0);
    const floorGeo = new THREE.PlaneGeometry(220, 160);
    floorGeo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorGeo, new THREE.ShaderMaterial({
        uniforms: { uT: U.uT, uE: U.uE, uWarm: U.uWarm, uWave: U.uWave, uMaster: U.uMaster, uPool: { value: pool }, uPoolC: { value: poolC }, uPoolI: { value: poolI } },
        vertexShader: 'varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
        fragmentShader: `#define NB ${NB}\n` + GLSL + `
uniform float uT,uE,uWarm,uWave,uMaster;
uniform vec3 uPool[NB]; uniform vec3 uPoolC[NB]; uniform float uPoolI[NB];
varying vec3 vW;
void main(){
    vec2 xz=vW.xz; float dist=length(vW-cameraPosition);
    vec2 sc=xz-vec2(0.,-12.5); float r=length(sc), ang=atan(sc.y,sc.x);
    vec3 warm=mix(vec3(.55,.72,1.),vec3(1.,.78,.38),uWarm);
    vec3 col=vec3(.006,.007,.02);
    float dais=1.-smoothstep(9.1,9.5,r);
    col+=dais*vec3(.020,.020,.040);
    // reflexo do portal (faixa central)
    float streak=exp(-xz.x*xz.x*.02)*(1.-smoothstep(-34.,8.,xz.y))*(.35+.65*uE);
    col+=warm*streak*.06;
    // grade de piso
    float gx=lineG(abs(fract(xz.x/3.+.5)-.5)*3.,.03), gz=lineG(abs(fract(xz.y/3.+.5)-.5)*3.,.03);
    col+=warm*(gx+gz)*.06*exp(-dist*.045)*(.5+uE);
    // círculo de runas
    float rim=lineG(r-9.3,.07)*1.6;
    float r2=lineG(r-7.9,.04)*step(.5,fract(ang*9./TAU-uT*.04));
    float r3=lineG(r-5.6,.04)*step(.5,fract(ang*14./TAU+uT*.05));
    float r4=lineG(r-3.2,.03)*.8;
    float ticks=step(.8,fract(ang*60./TAU))*lineG(r-9.9,.14);
    col+=warm*(rim+r2*.7+r3*.6+r4+ticks*.6)*(.45+.9*uE)*(.6+.4*dais);
    // onda de choque
    float wv=lineG(r-uWave*22.,.55)*(1.-uWave);
    col+=vec3(1.,.9,.7)*wv*1.4;
    // poças dos holofotes
    for(int i=0;i<NB;i++){vec2 d=xz-uPool[i].xy; float rr=uPool[i].z; col+=uPoolC[i]*exp(-dot(d,d)/(rr*rr))*uPoolI[i];}
    float fog=smoothstep(18.,75.,dist);
    col=mix(col,vec3(.012,.014,.035)+warm*.018*(.5+uE),fog);
    gl_FragColor=vec4(col*uMaster,1.);
}`,
    }));
    floor.position.set(0, 0, -30);
    floor.renderOrder = 0;
    scene.add(floor);

    // ── Treliça + holofotes móveis ───────────────────────────────────
    const tp = [];
    const TY1 = 14.4, TY2 = 13.3, TZ = -14, TL = 17;
    const seg = (a, b, c, d, e, f) => tp.push(a, b, c, d, e, f);
    seg(-TL, TY1, TZ, TL, TY1, TZ); seg(-TL, TY2, TZ, TL, TY2, TZ);
    for (let x = -TL; x < TL; x += 2.2) { seg(x, TY2, TZ, x + 1.1, TY1, TZ); seg(x + 1.1, TY1, TZ, x + 2.2, TY2, TZ); }
    for (const x of [-TL, TL]) seg(x, TY2, TZ, x, 0, TZ);
    const trussGeo = new THREE.BufferGeometry();
    trussGeo.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    scene.add(Object.assign(new THREE.LineSegments(trussGeo, new THREE.LineBasicMaterial(addMat({ color: new THREE.Color().setRGB(0.20, 0.16, 0.08), opacity: 0.8 }))), { renderOrder: 2 }));

    const L0 = 40;
    const beamGeo = new THREE.CylinderGeometry(2.7, 0.12, L0, 28, 1, true);
    beamGeo.translate(0, L0 / 2, 0);
    beamGeo.rotateX(Math.PI / 2);                       // apex em z=0, abre para +Z (lookAt aponta o +Z)
    const BEAM_FS = `
uniform vec3 uC; uniform float uI,uT,uPh; varying vec3 vN; varying vec3 vW; varying float vH;
void main(){
    vec3 V=normalize(cameraPosition-vW);
    float f=abs(dot(normalize(vN),V));
    float a=uI*pow(f,1.4)*smoothstep(0.,.04,vH)*pow(max(1.-vH,0.),.9);
    a*=.8+.2*sin(vH*30.-uT*2.+uPh);
    gl_FragColor=vec4(uC*a,1.);
}`;
    const BEAM_VS = `
uniform float uLen; varying vec3 vN; varying vec3 vW; varying float vH;
void main(){
    vN=normalize(transpose(inverse(mat3(modelMatrix)))*normal);
    vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vH=position.z/uLen;
    gl_Position=projectionMatrix*viewMatrix*w;
}`;
    const PAL_CALM = [[.55, .75, 1], [.9, .95, 1], [.45, .6, 1], [.8, .85, 1]];
    const PAL_EPIC = [[1, .78, .32], [1, .92, .72], [.75, .5, 1], [1, .62, .25], [.5, .7, 1]];
    const beams = [];
    for (let i = 0; i < NB; i++) {
        const fan = (i / (NB - 1)) * 2 - 1;
        const calm = new THREE.Color().setRGB(...PAL_CALM[i % PAL_CALM.length]);
        const epic = new THREE.Color().setRGB(...PAL_EPIC[i % PAL_EPIC.length]);
        const mat = new THREE.ShaderMaterial(addMat({
            uniforms: { uC: { value: new THREE.Color() }, uI: { value: 0 }, uT: U.uT, uPh: { value: rand(0, 6.28) }, uLen: { value: L0 } },
            vertexShader: BEAM_VS, fragmentShader: BEAM_FS, side: THREE.DoubleSide,
        }));
        const g = new THREE.Group();
        g.position.set(fan * 15, TY2 + 0.1, TZ - (i % 2) * 2);
        const mesh = new THREE.Mesh(beamGeo, mat);
        mesh.frustumCulled = false; mesh.renderOrder = 5;
        g.add(mesh); scene.add(g);
        beams.push({ g, mesh, mat, fan, calm, epic, ph: rand(0, 6.28), sky: i % 3 === 0, sk: 0, on: true });
    }

    // brilhos das lentes
    const flPos = new Float32Array(NB * 3), flC = new Float32Array(NB * 3), flS = new Float32Array(NB).fill(40);
    beams.forEach((b, i) => { flPos.set([b.g.position.x, b.g.position.y, b.g.position.z], i * 3); });
    const flGeo = new THREE.BufferGeometry();
    flGeo.setAttribute('position', new THREE.BufferAttribute(flPos, 3));
    flGeo.setAttribute('aC', new THREE.BufferAttribute(flC, 3));
    flGeo.setAttribute('aS', new THREE.BufferAttribute(flS, 1));
    const flares = new THREE.Points(flGeo, new THREE.ShaderMaterial(addMat({
        uniforms: { uPx: U.uPx, uMaster: U.uMaster },
        vertexShader: 'attribute vec3 aC;attribute float aS;uniform float uPx;varying vec3 vC;void main(){vC=aC;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=min(aS*uPx*(30./max(-mv.z,.5)),128.);}',
        fragmentShader: 'uniform float uMaster;varying vec3 vC;void main(){vec2 c=gl_PointCoord-.5;float d=length(c);float g=exp(-d*d*28.);float s=exp(-abs(c.x)*38.)*exp(-abs(c.y)*5.)+exp(-abs(c.y)*38.)*exp(-abs(c.x)*5.);gl_FragColor=vec4(vC*(g+s*.6)*uMaster,1.);}',
    })));
    flares.frustumCulled = false; flares.renderOrder = 6;
    scene.add(flares);

    // ── Neblina (2 camadas) ──────────────────────────────────────────
    const hazes = [];
    [[-7, 3.5, 0.55, 0.9], [-19, 6, 0.45, 0.6]].forEach(([z, y, al, spd]) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(110, 44), new THREE.ShaderMaterial(addMat({
            uniforms: { uT: U.uT, uWarm: U.uWarm, uE: U.uE, uMaster: U.uMaster, uA: { value: al }, uSpd: { value: spd }, uY: { value: y }, uK: { value: 0.16 } },
            vertexShader: 'varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
            fragmentShader: GLSL + `
uniform float uT,uWarm,uE,uMaster,uA,uSpd,uY,uK; varying vec3 vW;
void main(){
    vec3 warm=mix(vec3(.45,.62,1.),vec3(1.,.74,.36),uWarm);
    float f=fbm2(vW.xy*.055+vec2(uT*.012*uSpd,uT*.004));
    float band=exp(-pow((vW.y-uY)*uK,2.));
    float a=smoothstep(.38,.95,f)*band*uA*uMaster*(.6+.7*uE);
    float ex=1.-smoothstep(30.,52.,abs(vW.x));
    gl_FragColor=vec4(warm*a*ex*.10,1.);
}`,
        })));
        m.position.set(0, 6, z); m.renderOrder = 7; m.frustumCulled = false;
        scene.add(m); hazes.push(m);
    });

    // ── Brasas douradas + bokeh ──────────────────────────────────────
    function makeParticles(n, box, sizeMin, sizeMax, uSz, bokeh, alpha) {
        const pos = new Float32Array(n * 3), aR = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
            pos.set([rand(box[0], box[1]), rand(box[2], box[3]), rand(box[4], box[5])], i * 3);
            aR.set([Math.random(), rand(0.25, 1.0), rand(sizeMin, sizeMax), rand(0.8, 3)], i * 4);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aR', new THREE.BufferAttribute(aR, 4));
        const pts = new THREE.Points(geo, new THREE.ShaderMaterial(addMat({
            uniforms: { uT: U.uT, uPx: U.uPx, uWarm: U.uWarm, uMaster: U.uMaster, uSz: { value: uSz }, uSp: { value: 1 }, uBokeh: { value: bokeh }, uAl: { value: alpha } },
            vertexShader: `attribute vec4 aR; uniform float uT,uPx,uSz,uSp; varying float vA;
void main(){
    vec3 p=position; p.y=mod(p.y+uT*aR.y*uSp,24.);
    p.x+=sin(uT*.3+aR.x*6.283)*(.6+aR.z*.2); p.z+=cos(uT*.23+aR.x*9.)*.6;
    vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv;
    gl_PointSize=min(aR.z*uSz*uPx*(24./max(-mv.z,.5)),96.);
    vA=.3+.7*pow(.5+.5*sin(uT*aR.w+aR.x*40.),2.);
    vA*=smoothstep(0.,2.,p.y)*(1.-smoothstep(18.,24.,p.y));
}`,
            fragmentShader: `uniform float uWarm,uMaster,uBokeh,uAl; varying float vA;
void main(){
    float d=length(gl_PointCoord-.5);
    float disc=1.-smoothstep(0.,.5,d); disc*=disc;
    float bok=(1.-smoothstep(.40,.5,d))*.25+exp(-pow((d-.42)*14.,2.))*.7;
    float a=mix(disc,bok,uBokeh)*vA;
    gl_FragColor=vec4(mix(vec3(.6,.75,1.),vec3(1.,.82,.45),uWarm)*a*uMaster*uAl,1.);
}`,
        })));
        pts.frustumCulled = false; pts.renderOrder = 8;
        scene.add(pts);
        return pts;
    }
    const embers = makeParticles(900, [-26, 26, 0, 24, -40, 16], 1, 3, 1.6, 0, 0.7);
    const bokeh = makeParticles(40, [-12, 12, 0, 14, -4, 12], 1.2, 2.4, 9.0, 1, 0.22);

    // Sem pós-processamento de propósito: nada de bloom/blur de tela cheia (era isso que estourava a luz).
    // O brilho vem só dos próprios shaders, com níveis controlados por STAGE_GAIN.

    // ── Estado ───────────────────────────────────────────────────────
    let q = 'epic', E = 0.35, Et = 0.35, P = 0, introK = { v: 0 }, raf = 0, last = 0, running = false;
    let tx = 0, ty = 0, sx = 0, sy = 0, readT = 0, avgMs = 16, frames = 0, onDowngrade = null;
    const timeScale = REDUCED ? 0.25 : 1;
    const onPtr = (e) => { tx = (e.clientX / innerWidth - 0.5) * 2; ty = (e.clientY / innerHeight - 0.5) * 2; };
    const onTilt = (e) => { if (e.gamma != null && e.beta != null) { tx = clamp(e.gamma / 35, -1, 1); ty = clamp((e.beta - 50) / 35, -1, 1); } };
    addEventListener('pointermove', onPtr, { passive: true });
    addEventListener('deviceorientation', onTilt, { passive: true });

    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    function readSong() {
        const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
        const prog = clamp(scrollY / max, 0, 1);
        const secs = [...document.querySelectorAll('#sv .row.sec .ly')];
        if (!secs.length) return { e: 0.42 + 0.4 * prog, prog };      // sem seções: energia cresce com a rolagem
        const yy = innerHeight * 0.45; let cur = null;
        for (const el of secs) { if (el.getBoundingClientRect().top < yy) cur = el; else break; }
        if (!cur) return { e: 0.38, prog };
        const t = norm(cur.textContent);
        let e = 0.5;
        if (/pre.?refrao/.test(t)) e = 0.7;
        else if (/refrao|coro|chorus|final|clamor|aleluia|exalta/.test(t)) e = 0.95;
        else if (/solo|instrumental|interlud/.test(t)) e = 0.8;
        else if (/ponte|bridge/.test(t)) e = 0.68;
        else if (/fim|outro|encerr/.test(t)) e = 0.3;
        else if (/intro|verso|estrofe|parte|tag/.test(t)) e = 0.4;
        return { e, prog };
    }

    const tws = {};
    const run = (key, obj, to, ms, ease) => { if (tws[key]) tws[key].stop(); tws[key] = new TWEEN.Tween(obj, G).to(to, ms).easing(ease).start(); };
    function burst() {
        if (REDUCED) return;
        wave.value = 0; flash.value = 1;
        run('wave', wave, { value: 1 }, 1900, TWEEN.Easing.Cubic.Out);
        run('flash', flash, { value: 0 }, 1400, TWEEN.Easing.Quadratic.Out);
    }
    let introTimer = 0;
    function intro() {
        master.value = 0; introK.v = 0;
        run('master', master, { value: STAGE_GAIN }, 2600, TWEEN.Easing.Cubic.Out);
        run('introK', introK, { v: 1 }, 3800, TWEEN.Easing.Quartic.Out);
        clearTimeout(introTimer); introTimer = setTimeout(burst, 700);
    }

    function applyQuality(name) {
        q = name === 'soft' ? 'soft' : 'epic';
        const c = QUAL[q];
        // modo suave: só metade dos holofotes (os de índice par), para poupar GPU
        beams.forEach((b, i) => { b.on = c.beams >= NB || (i % 2 === 0 && i / 2 < c.beams); b.g.visible = b.on; });
        embers.geometry.setDrawRange(0, c.parts);
        bokeh.geometry.setDrawRange(0, c.bokeh);
        bokeh.visible = c.bokeh > 0;
        hazes.forEach((h) => { h.visible = c.haze; });
        resize();
    }
    function resize() {
        if (!R) return;
        const w = R.domElement.clientWidth || innerWidth, h = R.domElement.clientHeight || innerHeight;
        if (!w || !h) return;
        const pr = Math.min(window.devicePixelRatio || 1, 1.5) * QUAL[q].scale;
        R.setPixelRatio(pr); R.setSize(w, h, false);
        U.uPx.value = pr;
        cam.aspect = w / h;
        cam.fov = cam.aspect < 1 ? 66 : 52;
        cam.updateProjectionMatrix();
    }
    const onOri = () => setTimeout(resize, 250);
    addEventListener('resize', resize);
    addEventListener('orientationchange', onOri);

    const tmpT = new THREE.Vector3(), tmpD = new THREE.Vector3();
    function update(t, dt) {
        // energia (lê o DOM ~8x por segundo)
        readT += dt;
        if (readT > 0.12) {
            readT = 0;
            const s = readSong();
            const prev = Et; Et = s.e; P += (s.prog - P) * 0.35;
            if (Et >= 0.8 && prev < 0.8) burst();
        }
        E += (Et - E) * (1 - Math.exp(-dt * 1.6));
        U.uE.value = E; U.uWarm.value = clamp((E - 0.3) / 0.6, 0, 1);
        U.uT.value = t;
        const warm = U.uWarm.value, M = master.value;

        // holofotes
        const spd = 0.20 + 0.9 * E;
        beams.forEach((b, i) => {
            if (!b.on) { poolI[i] = 0; flC[i * 3] = flC[i * 3 + 1] = flC[i * 3 + 2] = 0; return; }
            let tgx = lerp(b.fan * 3.4, b.fan * 16 + Math.sin(t * spd + b.ph) * 9 * E, E);
            let tgy = 0.3;
            let tgz = lerp(-13.5, -13.5 + Math.cos(t * spd * 0.8 + b.ph * 1.7) * 10, E);
            if (b.sky) {
                b.sk = sstep(0.45, 0.9, E);
                tgx = lerp(tgx, b.fan * 28 + Math.sin(t * spd * 0.7 + b.ph) * 10, b.sk);
                tgy = lerp(tgy, 20 + Math.sin(t * spd + b.ph) * 7, b.sk);
                tgz = lerp(tgz, -32 + Math.cos(t * spd * 0.6 + b.ph) * 8, b.sk);
            }
            tmpT.set(tgx, tgy, tgz);
            b.g.lookAt(tmpT);
            b.mesh.scale.z = clamp(b.g.position.distanceTo(tmpT) * 1.1 / L0, 0.35, 3);
            const flick = 0.85 + 0.15 * Math.sin(t * 0.9 + b.ph * 3);
            let I = (0.28 + 0.45 * E) * flick;
            if (b.sky) I *= 0.2 + 0.8 * b.sk;
            const col = b.mat.uniforms.uC.value.copy(b.calm).lerp(b.epic, warm);
            b.mat.uniforms.uI.value = I * M;
            // poça no chão
            tmpD.set(0, 0, 1).applyQuaternion(b.g.quaternion);
            if (tmpD.y < -0.04) {
                const k = -b.g.position.y / tmpD.y;
                pool[i].set(b.g.position.x + tmpD.x * k, b.g.position.z + tmpD.z * k, 0.5 + k * 0.075);
                poolC[i].set(col.r, col.g, col.b);
                poolI[i] = I * 0.45;
            } else poolI[i] = 0;
            flC[i * 3] = col.r * (0.35 + 0.45 * I); flC[i * 3 + 1] = col.g * (0.35 + 0.45 * I); flC[i * 3 + 2] = col.b * (0.35 + 0.45 * I);
        });
        flGeo.attributes.aC.needsUpdate = true;
        embers.material.uniforms.uSp.value = 0.8 + 1.6 * E;

        // câmera: avança conforme a música rola, balança de leve, segue o ponteiro/giroscópio
        sx += (tx - sx) * 0.05; sy += (ty - sy) * 0.05;
        const k = introK.v;
        cam.position.set(
            sx * 1.6 + Math.sin(t * 0.08) * 1.2,
            4.6 + sy * 0.6 + Math.sin(t * 0.06) * 0.35 + E * 0.3,
            lerp(15, 9, P) + (1 - k) * 4.5 + (REDUCED ? 0 : Math.sin(t * 0.11) * 0.5));
        cam.lookAt(-sx * 0.8, 7 + E * 0.8, -22);
        cam.rotation.z += Math.sin(t * 0.05) * 0.008;
    }

    function frame(now) {
        if (!running) { raf = 0; return; }
        raf = requestAnimationFrame(frame);
        if (document.hidden) return;
        const rd = document.getElementById('rd');
        if (rd && !rd.hidden) return;                                  // leitor de PDF aberto: não gasta GPU
        const c = QUAL[q];
        const min = 1000 / c.fps;
        if (now - last < min - 1) return;
        const dtMs = now - last; last = now;
        const dt = Math.min(dtMs / 1000, 0.1);
        const r = getRenderer(host);
        if (!r) return;                                                // aguardando o skybox recuperar o contexto
        adopt(r);
        G.update(now);
        update((now / 1000) * timeScale, dt);
        R.render(scene, cam);
        // rebaixa a qualidade sozinho se o aparelho não acompanhar
        if (q === 'epic' && ++frames > 90) {
            avgMs = avgMs * 0.96 + Math.min(dtMs, 100) * 0.04;
            if (frames > 240 && avgMs > 30 && onDowngrade) { onDowngrade(); }
        }
    }

    applyQuality('epic');
    return {
        start() { if (running) return; running = true; last = performance.now(); avgMs = 16; frames = 0; resize(); intro(); if (!raf) raf = requestAnimationFrame(frame); },
        stop() { running = false; cancelAnimationFrame(raf); raf = 0; clearTimeout(introTimer); giveBack(); },
        intro, burst, resize,
        setQuality: applyQuality,
        setGain(v) { STAGE_GAIN = clamp(v, 0.2, 1.4); if (!tws.master || !tws.master.isPlaying()) master.value = STAGE_GAIN; },
        set onDowngrade(fn) { onDowngrade = fn; },
    };
}

function startStage() {
    const song = $('#song');
    if (!song) return;
    const dom = injectStageDom();
    const LABEL = { epic: 'Palco: Épico', soft: 'Palco: Suave', off: 'Palco: Desligado' };
    let want = store.get('cifras.stage');
    if (!LABEL[want]) want = REDUCED || /Mobi|Android/.test(navigator.userAgent) && (navigator.deviceMemory || 4) <= 2 ? 'soft' : 'epic';
    let ctl = null, building = null, active = false, tipT = 0;

    const showTip = () => { dom.tip.textContent = LABEL[want]; dom.tip.classList.add('on'); clearTimeout(tipT); tipT = setTimeout(() => dom.tip.classList.remove('on'), 1400); };
    function classes() { BODY.classList.toggle('stage-soft', want === 'soft'); BODY.classList.toggle('stage-off', want === 'off'); }
    async function ensure() {
        if (ctl || want === 'off') return ctl;
        if (!building) building = buildStage(dom.host).then((c) => {
            if (c) c.onDowngrade = () => { if (want === 'epic') { want = 'soft'; classes(); c.setQuality('soft'); console.info('[CifrasStage] aparelho lento: modo Suave ativado automaticamente.'); } };
            ctl = c; if (!c) building = null; return c;
        });
        return building;
    }
    async function sync() {
        classes();
        if (!active || want === 'off') {
            if (ctl) ctl.stop();                       // devolve o renderer ao skybox
            const SB = window.CifrasSkybox;
            if (SB && SB.release) SB.release();
            dom.host.classList.remove('fb');
            return;
        }
        const c = await ensure();
        if (!c || !active) return;
        const SB = window.CifrasSkybox;
        const shared = !!(SB && SB.isReady && SB.isReady() && !SB.isFlat() && SB.borrow && SB.borrow());
        dom.host.classList.toggle('fb', !shared);      // sem skybox: usa o #songStage com renderer próprio
        c.setQuality(want);
        c.start();
    }

    new MutationObserver(() => {
        const on = song.classList.contains('active');
        if (on === active) return;
        active = on;
        BODY.classList.toggle('onsong', on);
        sync();
    }).observe(song, { attributes: true, attributeFilter: ['class'] });

    // trocou de música com a tela já aberta (anterior/próxima da setlist): "abre a cortina" de novo
    let lastTitle = '';
    const sv = $('#sv');
    if (sv) new MutationObserver(() => {
        const h = sv.querySelector('h2'), t = h ? h.textContent : '';
        if (t !== lastTitle) { const had = lastTitle; lastTitle = t; if (had && active && ctl && want !== 'off') ctl.intro(); }
    }).observe(sv, { childList: true });

    dom.btn.addEventListener('click', () => {
        want = want === 'epic' ? 'soft' : want === 'soft' ? 'off' : 'epic';
        store.set('cifras.stage', want);
        showTip(); sync();
    });
    classes();
    if (song.classList.contains('active')) { active = true; BODY.classList.add('onsong'); sync(); }

    window.CifrasStage = { setGain(v) { STAGE_GAIN = clamp(v, 0.2, 1.4); if (ctl) ctl.setGain(v); }, setQuality(v) { if (LABEL[v]) { want = v; store.set('cifras.stage', v); sync(); } }, getQuality: () => want, burst: () => ctl && ctl.burst() };
}

try { startStage(); } catch (e) { console.warn('[CifrasFX] palco indisponível', e); }
