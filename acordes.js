/* Cifras PIBM — análise de acordes no navegador (Essentia.js / WebAssembly).
   Script SEPARADO do cifras.html (fica em cache no service worker).
   Essentia.js é AGPL-3.0: https://github.com/MTG/essentia.js

   Uso:  const ess = await carregar();
         const cf = await analisar(ess, amostrasMono, taxa, { sequencia:['G','C','Em','D',...] | null, onProgress });
   Resultado (cabe em ~2 KB e vai junto com os dados da música):
         { v:1, m:'a'|'b', sh:semitons, q:custoMedio, n:[nomes], e:[[segundos, indice],...] }
         m='a'  alinhado à cifra escrita: n = acordes da cifra (na ordem) e e = quando cada um entra
         m='b'  acordes detectados às cegas: n = nomes únicos detectados                                  */

const ESS = 'https://cdn.jsdelivr.net/npm/essentia.js@0.1.3/dist/';
let EM = null;

export async function carregar() {
  if (EM) return EM;
  const [w, c] = await Promise.all([import(ESS + 'essentia-wasm.es.js'), import(ESS + 'essentia.js-core.es.js')]);
  const wasm = w.EssentiaWASM;
  for (let i = 0; i < 300 && typeof wasm.EssentiaJS !== 'function'; i++) await new Promise(r => setTimeout(r, 50));
  if (typeof wasm.EssentiaJS !== 'function') throw new Error('O Essentia não iniciou');
  EM = new c.default(wasm);
  return EM;
}

const N = 8192, HOP = 4096;                       /* 0,37 s por janela, uma janela a cada 0,19 s (22,05 kHz) */
const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const tick = () => new Promise(r => setTimeout(r, 0));

/* ---------- cifra -> vetor de 12 notas ---------- */
export function parseChord(n) {
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec((n || '').trim());
  if (!m || NOTE[m[1]] == null) return null;
  const root = NOTE[m[1]], q = m[2] || '', bass = m[3] && NOTE[m[3]] != null ? NOTE[m[3]] : null;
  const w = new Float64Array(12), add = (iv, p) => { w[(root + iv) % 12] = Math.max(w[(root + iv) % 12], p) };
  const minor = /^(m(?!aj)|min|-)/.test(q) && !/^dim/.test(q);
  add(0, 1); add(7, .8);
  if (/dim/.test(q)) { add(3, .9); add(6, .8); w[(root + 7) % 12] = 0 }
  else if (/aug|\+/.test(q)) { add(4, .9); add(8, .8); w[(root + 7) % 12] = 0 }
  else if (/sus2/.test(q)) add(2, .9);
  else if (/sus/.test(q)) add(5, .9);
  else if (/^5$/.test(q)) { /* power chord */ }
  else add(minor ? 3 : 4, .9);
  if (/maj7|M7|Δ|7M/.test(q)) add(11, .55);
  else if (/(^|[^a-z])(7|9|11|13)/.test(q) && !/add/.test(q)) add(10, .55);
  if (/6/.test(q)) add(9, .5);
  if (/(9|add9|add2)/.test(q)) add(2, .4);
  if (bass != null) w[bass] = Math.max(w[bass], .6);
  return w;
}
const unit = v => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; s = Math.sqrt(s) || 1; return v.map(x => x / s) };
const rot = (t, s) => { const o = new Float64Array(12); for (let k = 0; k < 12; k++) o[(k + s) % 12] = t[k]; return o };

/* ---------- áudio -> HPCP (Essentia) ---------- */
export async function hpcpFrames(ess, x, sr, onP) {
  const F = Math.max(1, Math.floor((x.length - N) / HOP) + 1), out = new Float64Array(F * 12), buf = new Float32Array(N);
  for (let f = 0; f < F; f++) {
    buf.fill(0); buf.set(x.subarray(f * HOP, Math.min(x.length, f * HOP + N)));
    let e = 0; for (let i = 0; i < N; i += 16) e += buf[i] * buf[i];
    if (e > 1e-6) {
      const fv = ess.arrayToVector(buf), w = ess.Windowing(fv, true, N, 'blackmanharris62'), sp = ess.Spectrum(w.frame, N);
      const pk = ess.SpectralPeaks(sp.spectrum, 0.0001, 3500, 100, 100, 'frequency', sr);
      const h = ess.HPCP(pk.frequencies, pk.magnitudes, false, 500, 4, 3500, false, 100, false, 'unitMax', 440, sr, 12, 'cosine', 1);
      const a = ess.vectorToArray(h.hpcp);
      for (let k = 0; k < 12; k++) out[f * 12 + (9 + k) % 12] = a[k];        /* o bin 0 do HPCP é A (440 Hz); aqui 0 = C */
      [fv, w.frame, sp.spectrum, pk.frequencies, pk.magnitudes, h.hpcp].forEach(v => { try { v.delete() } catch (_) { } });
    }
    if (onP && f % 20 === 0) { onP(f / F); await tick() }
  }
  /* suaviza (média de 3 janelas) e normaliza */
  const S = new Float64Array(F * 12), valid = new Uint8Array(F);
  for (let f = 0; f < F; f++) {
    const v = new Float64Array(12);
    for (let d = -1; d <= 1; d++) { const g = Math.min(F - 1, Math.max(0, f + d)); for (let k = 0; k < 12; k++) v[k] += out[g * 12 + k] }
    let s = 0; for (let k = 0; k < 12; k++) s += v[k] * v[k];
    if (s > 1e-9) { const u = unit(v); S.set(u, f * 12); valid[f] = 1 }
  }
  return { H: S, valid, F, hop: HOP / sr, off: (N / 2) / sr };
}

/* ---------- alinhamento com a cifra escrita (Viterbi) ---------- */
const STAY = 0, NEXT = .35, SKIP = .85, JUMP = .9, START = .6;
function emis(H, valid, F, T) {            /* custo = 1 - cosseno */
  const n = T.length, E = new Float32Array(F * n);
  for (let f = 0; f < F; f++) for (let j = 0; j < n; j++) {
    if (!valid[f]) { E[f * n + j] = .7; continue }
    let d = 0; const t = T[j]; for (let k = 0; k < 12; k++) d += H[f * 12 + k] * t[k];
    E[f * n + j] = 1 - d;
  }
  return E;
}
/* Viterbi: estados = acordes da cifra; permanece, avança, pula um ou salta para o início de uma linha (repetição) */
function viterbi(E, F, n, ls) {
  let prev = new Float64Array(n).fill(START), cur = new Float64Array(n); prev[0] = 0;
  const bp = new Int16Array(F * n), gArg = new Int16Array(F);
  for (let f = 0; f < F; f++) {
    let best = Infinity, arg = 0; for (let j = 0; j < n; j++) if (prev[j] < best) { best = prev[j]; arg = j }
    gArg[f] = arg;
    for (let j = 0; j < n; j++) {
      let c = prev[j] + STAY, b = j;
      if (j > 0 && prev[j - 1] + NEXT < c) { c = prev[j - 1] + NEXT; b = j - 1 }
      if (j > 1 && prev[j - 2] + SKIP < c) { c = prev[j - 2] + SKIP; b = j - 2 }
      if (ls[j] && best + JUMP < c) { c = best + JUMP; b = -1 }
      cur[j] = c + E[f * n + j]; bp[f * n + j] = b;
    }
    const t = prev; prev = cur; cur = t;
  }
  let end = 0; for (let j = 1; j < n; j++) if (prev[j] < prev[end]) end = j;
  const path = new Int16Array(F); let j = end;
  for (let f = F - 1; f >= 0; f--) { path[f] = j; const b = bp[f * n + j]; j = b === -1 ? gArg[f] : b }
  return { cost: prev[end], path };
}

/* ---------- detecção às cegas (maior, menor, com sétima) ---------- */
function blind(H, valid, F) {
  const T = [], nm = [];
  for (let r = 0; r < 12; r++) for (const [q, ivs, suf] of [[0, [0, 4, 7], ''], [1, [0, 3, 7], 'm'], [2, [0, 4, 7, 10], '7']]) {
    const w = new Float64Array(12); ivs.forEach((iv, i) => { w[(r + iv) % 12] = i === 0 ? 1 : (iv === 10 ? .55 : .85) }); T.push(unit(w)); nm.push(NAMES[r] + suf);
  }
  const n = T.length, E = emis(H, valid, F, T), CH = .45;
  let prev = new Float64Array(n), cur = new Float64Array(n); const bp = new Int16Array(F * n), g = new Int16Array(F);
  for (let f = 0; f < F; f++) {
    let best = Infinity, arg = 0; for (let j = 0; j < n; j++) if (prev[j] < best) { best = prev[j]; arg = j } g[f] = arg;
    for (let j = 0; j < n; j++) { let c = prev[j], b = j; if (best + CH < c) { c = best + CH; b = -1 } cur[j] = c + E[f * n + j]; bp[f * n + j] = b }
    const t = prev; prev = cur; cur = t;
  }
  let end = 0; for (let j = 1; j < n; j++) if (prev[j] < prev[end]) end = j;
  const path = new Int16Array(F); let j = end; for (let f = F - 1; f >= 0; f--) { path[f] = j; const b = bp[f * n + j]; j = b === -1 ? g[f] : b }
  let sum = 0; for (let f = 0; f < F; f++) sum += E[f * n + path[f]];
  return { path, names: nm, q: sum / F };
}

/* ---------- API principal ---------- */
export async function analisar(ess, x, sr, opt = {}) {
  const prog = opt.onProgress || (() => { });
  const { H, valid, F, hop, off } = await hpcpFrames(ess, x, sr, p => prog(p * .8));
  const time = f => off + f * hop - hop / 2;
  const mk = (path, nameList) => {       /* junta quadros iguais em eventos [segundos, indice] */
    const e = []; let last = -1;
    for (let f = 0; f < F; f++) if (path[f] !== last) { e.push([Math.max(0, +time(f).toFixed(1)), path[f]]); last = path[f] }
    return e;
  };
  const names = opt.sequencia || [], seq = names.map(parseChord);
  let res = null;
  /* acordes iguais em sequência na cifra viram um só estado (não dá para distinguir pelo som); o tempo é dividido igualmente entre eles */
  const groups = []; names.forEach((nm, i) => { const g = groups[groups.length - 1]; if (g && names[g[g.length - 1]] === nm) g.push(i); else groups.push([i]) });
  if (groups.length >= 2 && seq.every(Boolean)) {
    const n = groups.length, inic = new Set(opt.inicios || []), ls = new Uint8Array(n);
    groups.forEach((g, gi) => { if (gi === 0 || g.some(i => inic.has(i))) ls[gi] = 1 });
    if (!(opt.inicios && opt.inicios.length)) ls.fill(1);
    const base = groups.map(g => unit(seq[g[0]]));
    let bestS = 0, bestR = null;
    for (let s = 0; s < 12; s++) {
      const T = base.map(t => rot(t, s)), E = emis(H, valid, F, T), r = viterbi(E, F, n, ls);
      const c = r.cost + (s ? 1.5 : 0);                                              /* prefere o tom original em caso de empate */
      if (!bestR || c < bestR.c) { bestR = { c, path: r.path, E }; bestS = s }
      prog(.8 + .18 * (s + 1) / 12); if (s % 3 === 2) await tick();
    }
    let sum = 0; for (let f = 0; f < F; f++) sum += bestR.E[f * n + bestR.path[f]];
    const q = sum / F;
    const qb = blind(H, valid, F).q;                         /* a cifra só vale se explicar a gravação quase tão bem quanto a detecção livre */
    if (q <= .6 && q <= qb + .15) {
      const eg = mk(bestR.path), endT = +(x.length / sr).toFixed(1), e = [];
      eg.forEach(([t, g], j) => { const mem = groups[g], span = (eg[j + 1] ? eg[j + 1][0] : endT) - t; mem.forEach((idx, k) => e.push([+(t + k * span / mem.length).toFixed(1), idx])) });
      res = { v: 1, m: 'a', sh: bestS, q: +q.toFixed(2), n: names.slice(), e };
    }
  }
  if (!res) {                                                                          /* sem cifra, ou a cifra não bate com a gravação */
    const b = blind(H, valid, F), used = [...new Set(b.path)], map = new Map(used.map((u, i) => [u, i]));
    const p2 = Int16Array.from(b.path, u => map.get(u));
    res = { v: 1, m: 'b', sh: 0, q: 0, n: used.map(u => b.names[u]), e: mk(p2) };
  }
  prog(1);
  return res;
}
