// loading.js
// Responsável por:
//  1) Baixar/extrair os pacotes de assets (zips do GitHub Releases) que estiverem desatualizados
//  2) Mostrar progresso detalhado (download em MB e extração em nº de arquivos)
//  3) Liberar as imagens que estavam com data-src (evita 404 de assets que só existem no zip)
//  4) Só depois disso, rodar o monitoramento de carregamento de recursos (lógica original)
//     e permitir que a tela de loading feche (junto com o authCheckComplete do script.js)

// =====================================================================
// CONFIGURAÇÃO — ajuste aqui o usuário/repositório do GitHub
// =====================================================================
// Proxy same-origin (Cloudflare Pages Function) — não aponta mais direto
// pro GitHub porque os binários de Release do GitHub não têm CORS
// habilitado, e o navegador bloqueia o fetch() direto. Ver
// functions/assets-zip/[tag]/[filename].js para o proxy correspondente.
const GITHUB_RELEASES_BASE = '/assets-zip';
const VERSION_JSON_URL = '/assets-version.json';
const ZIP_CACHE_NAME = 'aden-rpg-zip-assets-v1'; // tem que ser IGUAL ao CACHE_ZIP_ASSETS do sw.js
const MAX_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 2000;
const EXTRACT_CONCURRENCY = 5; // quantos arquivos extraídos em paralelo por vez

// =====================================================================
// Estado global exposto para o resto do jogo (script.js pode usar isso
// pra esperar antes de tocar música/vídeo de intro que vieram de zip)
// =====================================================================
window.assetsReady = false;
window.assetsReadyPromise = new Promise(resolve => {
    window.__resolveAssetsReady = resolve;
});

// botao.webp e aden_ini.webp continuam no repositório (não são zipados —
// button/.btn e o #authContainer aparecem imediatamente, antes de qualquer
// tela de loading), então liberamos essas duas variáveis de CSS na hora.
// As outras (menu lateral, espiral, loja, mapa) só depois que os pacotes
// de assets forem conferidos — ver liberarBackgroundsAdiados().
document.documentElement.style.setProperty('--bg-botao', "url('https://aden-rpg.pages.dev/assets/botao.webp')");
document.documentElement.style.setProperty('--bg-aden-ini', "url('https://aden-rpg.pages.dev/assets/aden_ini.webp')");

document.addEventListener('DOMContentLoaded', () => {
    baixarEExtrairAssets();
});

// =====================================================================
// UI da tela de loading
// =====================================================================
function getLoadingEls() {
    return {
        overlay: document.getElementById('loading-overlay'),
        title: document.getElementById('loading-title'),
        progressBar: document.getElementById('progress-bar'),
        progressText: document.getElementById('progress-text'),
        statusText: document.getElementById('asset-status-text'),
        warningText: document.getElementById('asset-warning-text'),
        confirmBox: document.getElementById('asset-confirm-box'),
        confirmMessage: document.getElementById('asset-confirm-message'),
        confirmBtn: document.getElementById('asset-confirm-btn'),
        cancelBtn: document.getElementById('asset-cancel-btn'),
        progressBox: document.getElementById('asset-progress-box'),
    };
}

function setLoadingTitle(text) {
    const { title } = getLoadingEls();
    if (title) title.textContent = text;
}

function setStatusText(text) {
    const { statusText } = getLoadingEls();
    if (statusText) statusText.textContent = text;
}

function setWarningVisible(visible) {
    const { warningText } = getLoadingEls();
    if (warningText) warningText.style.display = visible ? 'block' : 'none';
}

// Barra de progresso GERAL — cobre download + extração de todos os
// pacotes pendentes juntos, não só o carregamento final da página.
// Assim o jogador tem noção real de quanto falta em vez de ver 0% parado
// durante o download inteiro.
function setProgressBarPercent(pct) {
    const { progressBar, progressText } = getLoadingEls();
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    if (progressBar) progressBar.style.width = `${clamped}%`;
    if (progressText) progressText.innerText = `${clamped}%`;
}

function formatMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForOnline() {
    if (navigator.onLine) return Promise.resolve();
    setStatusText('Sem conexão com a internet. Aguardando reconectar...');
    return new Promise(resolve => {
        const handler = () => {
            window.removeEventListener('online', handler);
            resolve();
        };
        window.addEventListener('online', handler);
    });
}

// =====================================================================
// Traduções fixas pro modal de confirmação de download — mesma lógica
// usada em offline.html: lê o cookie "googtrans" (funciona mesmo que o
// Google Tradutor ainda não tenha inicializado, que é sempre o caso aqui,
// já que esse modal aparece ANTES de qualquer coisa na página).
// =====================================================================
const CONFIRM_TRANSLATIONS = {
    pt: { msg: (mb) => `Download de ${mb} MB de dados necessário. Deseja continuar?`, ok: 'Continuar', cancel: 'Cancelar' },
    en: { msg: (mb) => `A ${mb} MB data download is required. Do you want to continue?`, ok: 'Continue', cancel: 'Cancel' },
    es: { msg: (mb) => `Se requiere una descarga de ${mb} MB de datos. ¿Deseas continuar?`, ok: 'Continuar', cancel: 'Cancelar' },
    'zh-CN': { msg: (mb) => `需要下载 ${mb} MB 的数据。是否继续？`, ok: '继续', cancel: '取消' },
    ja: { msg: (mb) => `${mb} MB のデータのダウンロードが必要です。続行しますか？`, ok: '続行', cancel: 'キャンセル' },
    ko: { msg: (mb) => `${mb} MB의 데이터 다운로드가 필요합니다. 계속하시겠습니까?`, ok: '계속', cancel: '취소' },
    id: { msg: (mb) => `Diperlukan unduhan data sebesar ${mb} MB. Lanjutkan?`, ok: 'Lanjutkan', cancel: 'Batal' },
    tl: { msg: (mb) => `Kailangan ng ${mb} MB na download ng data. Magpatuloy?`, ok: 'Magpatuloy', cancel: 'Kanselahin' },
    ru: { msg: (mb) => `Требуется загрузка данных объемом ${mb} МБ. Продолжить?`, ok: 'Продолжить', cancel: 'Отмена' },
    it: { msg: (mb) => `È necessario scaricare ${mb} MB di dati. Vuoi continuare?`, ok: 'Continua', cancel: 'Annulla' },
    fr: { msg: (mb) => `Un téléchargement de ${mb} Mo de données est nécessaire. Voulez-vous continuer ?`, ok: 'Continuer', cancel: 'Annuler' },
    hi: { msg: (mb) => `${mb} MB डेटा डाउनलोड करना आवश्यक है। क्या आप जारी रखना चाहते हैं?`, ok: 'जारी रखें', cancel: 'रद्द करें' },
    ms: { msg: (mb) => `Muat turun data sebanyak ${mb} MB diperlukan. Teruskan?`, ok: 'Teruskan', cancel: 'Batal' },
    vi: { msg: (mb) => `Cần tải xuống ${mb} MB dữ liệu. Bạn có muốn tiếp tục không?`, ok: 'Tiếp tục', cancel: 'Hủy' },
    ar: { msg: (mb) => `يلزم تنزيل ${mb} ميجابايت من البيانات. هل تريد المتابعة؟`, ok: 'متابعة', cancel: 'إلغاء' },
};

function getSelectedLangFromCookie() {
    const cookies = document.cookie.split(';');
    const googCookie = cookies.find(c => c.trim().startsWith('googtrans='));
    if (googCookie) {
        const value = googCookie.split('=')[1] || '';
        const parts = value.split('/').filter(Boolean);
        if (parts[1]) return parts[1];
    }
    // Sem cookie ainda (primeiríssima visita, antes de escolher idioma) —
    // tenta adivinhar pelo idioma do aparelho/navegador em vez de cair
    // direto em português.
    return detectarIdiomaNavegador();
}

function detectarIdiomaNavegador() {
    const candidatos = navigator.languages && navigator.languages.length
        ? navigator.languages
        : [navigator.language || 'pt'];
    const suportados = Object.keys(CONFIRM_TRANSLATIONS);
    for (const raw of candidatos) {
        if (!raw) continue;
        const lower = raw.toLowerCase();
        if (lower.startsWith('zh')) return 'zh-CN';
        const base = lower.split('-')[0];
        if (base === 'fil') return 'tl';
        if (suportados.includes(base)) return base;
    }
    return 'pt';
}

// =====================================================================
// Modal de confirmação: mostra o tamanho total do download e espera o
// jogador decidir antes de gastar a banda dele.
// Resolve com true (Continuar) ou false (Cancelar).
// =====================================================================
function pedirConfirmacaoDownload(totalBytes) {
    return new Promise(resolve => {
        const { confirmBox, confirmMessage, confirmBtn, cancelBtn, progressBox } = getLoadingEls();

        const lang = getSelectedLangFromCookie();
        const t = CONFIRM_TRANSLATIONS[lang] || CONFIRM_TRANSLATIONS.pt;
        const mb = formatMB(totalBytes);

        if (confirmMessage) confirmMessage.textContent = t.msg(mb);
        if (confirmBtn) confirmBtn.textContent = t.ok;
        if (cancelBtn) cancelBtn.textContent = t.cancel;

        if (progressBox) progressBox.style.display = 'none';
        if (confirmBox) confirmBox.style.display = 'block';

        const onConfirm = () => {
            cleanup();
            if (progressBox) progressBox.style.display = 'block';
            if (confirmBox) confirmBox.style.display = 'none';
            resolve(true);
        };
        const onCancel = () => {
            cleanup();
            resolve(false);
        };
        function cleanup() {
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        }

        if (confirmBtn) confirmBtn.addEventListener('click', onConfirm);
        if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
    });
}

// Melhor esforço: não existe API garantida pra fechar um PWA/TWA instalado
// via JavaScript (window.close() só funciona em abas abertas por script).
// Tentamos mesmo assim; se não fechar, deixamos uma mensagem estática.
function tentarFecharApp() {
    try { window.close(); } catch (e) { /* ignora */ }
    setTimeout(() => {
        const lang = getSelectedLangFromCookie();
        const t = CONFIRM_TRANSLATIONS[lang] || CONFIRM_TRANSLATIONS.pt;
        setLoadingTitle('');
        setStatusText('');
        const { confirmMessage, confirmBox, progressBox, confirmBtn, cancelBtn } = getLoadingEls();
        if (progressBox) progressBox.style.display = 'none';
        if (confirmBox) confirmBox.style.display = 'block';
        if (confirmBtn) confirmBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (confirmMessage) {
            confirmMessage.textContent = lang === 'pt'
                ? 'Você pode fechar o aplicativo agora.'
                : 'You can close the app now.';
        }
    }, 300);
}



// =====================================================================
// Marcação de versão por pacote — guardada DENTRO do próprio Cache Storage
// (não em localStorage), pra nunca ficar dessincronizada dos arquivos reais.
// Se o navegador despejar o cache, o marcador some junto e o pacote é
// baixado de novo automaticamente. Isso também resolve o caso de o
// jogador fechar o app no meio do processo: como o marcador só é salvo
// depois que o pacote inteiro foi extraído, ao reabrir o jogo ele
// simplesmente recomeça daquele pacote (os anteriores, já concluídos, são
// pulados).
// =====================================================================
function versionMarkerRequest(nomePacote) {
    return new Request(`https://internal.local/pkg-version/${nomePacote}`);
}

async function getStoredVersion(cache, nomePacote) {
    const res = await cache.match(versionMarkerRequest(nomePacote));
    if (!res) return null;
    return await res.text();
}

async function setStoredVersion(cache, nomePacote, versao) {
    await cache.put(versionMarkerRequest(nomePacote), new Response(versao));
}

function getContentType(filename) {
    if (filename.endsWith('.png')) return 'image/png';
    if (filename.endsWith('.webp')) return 'image/webp';
    if (filename.endsWith('.mp3')) return 'audio/mpeg';
    if (filename.endsWith('.webm')) return 'video/webm';
    if (filename.endsWith('.mp4')) return 'video/mp4';
    if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'image/jpeg';
    return 'application/octet-stream';
}

// =====================================================================
// Descobre o tamanho de um zip via HEAD, sem baixar o conteúdo.
// =====================================================================
async function obterTamanhoZip(url) {
    try {
        const resp = await fetch(url, { method: 'HEAD' });
        if (!resp.ok) return 0;
        return Number(resp.headers.get('Content-Length')) || 0;
    } catch (e) {
        return 0;
    }
}

// =====================================================================
// Download do zip com progresso real (bytes recebidos / Content-Length)
// e retry automático com backoff em caso de falha de rede.
// onBytes(recebidos, totalConhecido) é chamado a cada chunk — usado pra
// alimentar a barra de progresso GERAL (todos os pacotes juntos).
// =====================================================================
async function downloadZipWithProgress(url, nomePacote, onBytes) {
    let lastErr;

    for (let tentativa = 1; tentativa <= MAX_RETRIES; tentativa++) {
        try {
            await waitForOnline();

            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status} ao baixar ${nomePacote}.zip`);

            const totalBytes = Number(response.headers.get('Content-Length')) || 0;
            const reader = response.body.getReader();
            const chunks = [];
            let recebidos = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                recebidos += value.length;

                const totalTxt = totalBytes ? `${formatMB(totalBytes)} MB` : '? MB';
                setStatusText(`Baixando dados (${nomePacote})... ${formatMB(recebidos)} MB / ${totalTxt}`);
                if (onBytes) onBytes(recebidos, totalBytes);
            }

            return new Blob(chunks);

        } catch (err) {
            lastErr = err;
            console.warn(`⚠️ Tentativa ${tentativa}/${MAX_RETRIES} falhou para ${nomePacote}:`, err);
            if (tentativa < MAX_RETRIES) {
                setStatusText(`Falha na conexão. Tentando novamente (${tentativa}/${MAX_RETRIES})...`);
                await sleep(RETRY_BASE_DELAY_MS * tentativa);
            }
        }
    }

    throw lastErr;
}

// =====================================================================
// Extração do zip para o Cache Storage, com concorrência limitada
// (evita segurar dezenas/centenas de arquivos inteiros na RAM ao mesmo
// tempo — importante para pacotes com vídeo) e idempotente (pula
// arquivos que já estão no cache, útil se uma tentativa anterior parou
// no meio da extração deste mesmo zip).
// onFiles(concluidos, total) alimenta a barra de progresso GERAL.
// =====================================================================
async function extractZipToCache(blob, cache, nomePacote, onFiles) {
    const zip = await JSZip.loadAsync(blob);

    const entries = [];
    zip.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir) entries.push(zipEntry);
    });

    const total = entries.length;
    let concluidos = 0;
    setStatusText(`Extraindo (${nomePacote})... 0 / ${total} arquivos`);
    if (onFiles) onFiles(0, total);

    let indice = 0;
    async function worker() {
        while (indice < entries.length) {
            const zipEntry = entries[indice++];
            const assetUrl = `/assets/${zipEntry.name}`;

            const jaExiste = await cache.match(assetUrl);
            if (!jaExiste) {
                const fileData = await zipEntry.async('blob');
                const responseToCache = new Response(fileData, {
                    headers: { 'Content-Type': getContentType(zipEntry.name) }
                });
                await cache.put(assetUrl, responseToCache);
            }

            concluidos++;
            setStatusText(`Extraindo (${nomePacote})... ${concluidos} / ${total} arquivos`);
            if (onFiles) onFiles(concluidos, total);
        }
    }

    const workers = [];
    for (let i = 0; i < EXTRACT_CONCURRENCY; i++) workers.push(worker());
    await Promise.all(workers);
}

// =====================================================================
// Libera as imagens/áudio/vídeo que ficaram esperando com data-src,
// evitando que o navegador tente buscá-las antes dos assets existirem.
// =====================================================================
function promoverAssetsAdiados() {
    document.querySelectorAll('[data-src]').forEach(el => {
        el.src = el.dataset.src;
        el.removeAttribute('data-src');
    });
    liberarBackgroundsAdiados();
}

// Backgrounds de CSS que vêm de pacotes zipados (menu lateral, espiral,
// loja, mapa) — só liberamos depois que os pacotes já estão garantidos no
// cache. botao.webp e aden_ini.webp NÃO entram aqui: são liberados de
// imediato no topo do arquivo, pois ficam permanentemente no repositório.
function liberarBackgroundsAdiados() {
    const root = document.documentElement.style;
    root.setProperty('--bg-menulateralbg', "url('https://aden-rpg.pages.dev/assets/menulateralbg.webp')");
    root.setProperty('--bg-espiralbg', "url('https://aden-rpg.pages.dev/assets/espiralbg.webp')");
    root.setProperty('--bg-lojabg', "url('https://aden-rpg.pages.dev/assets/lojabg.webp')");
    root.setProperty('--bg-mapa-aden', "url('https://aden-rpg.pages.dev/assets/mapa_aden.png')");
}

// =====================================================================
// Fluxo principal
// =====================================================================
async function baixarEExtrairAssets() {
    let avisoAtivo = false;
    const beforeUnloadHandler = (e) => {
        e.preventDefault();
        e.returnValue = '';
        return '';
    };

    try {
        const cache = await caches.open(ZIP_CACHE_NAME);

        const versionResponse = await fetch(VERSION_JSON_URL + '?t=' + Date.now());
        const pacotesServidor = await versionResponse.json();

        // Primeiro descobre quais pacotes realmente precisam ser baixados,
        // sem mexer na UI se não houver nada a fazer (caminho rápido pra
        // quem já está com tudo atualizado).
        const pendentes = [];
        for (const [nomePacote, versaoServidor] of Object.entries(pacotesServidor)) {
            const versaoLocal = await getStoredVersion(cache, nomePacote);
            if (versaoLocal !== versaoServidor) {
                pendentes.push([nomePacote, versaoServidor]);
            } else {
                console.log(`✅ Pacote [${nomePacote}] já está atualizado.`);
            }
        }

        if (pendentes.length > 0) {
            setLoadingTitle('Carregando');
            setProgressBarPercent(0);

            // Descobre o tamanho de cada pacote pendente via HEAD (sem
            // gastar banda) pra poder: 1) mostrar o modal de confirmação
            // com o total em MB, e 2) ponderar a barra de progresso geral
            // pelo peso (em bytes) de cada pacote.
            setStatusText('Verificando tamanho da atualização...');
            const pesos = []; // [nomePacote, versaoServidor, zipUrl, tamanhoBytes]
            let totalBytesGeral = 0;
            for (const [nomePacote, versaoServidor] of pendentes) {
                const zipUrl = `${GITHUB_RELEASES_BASE}/${versaoServidor}/${nomePacote}.zip`;
                const tamanho = await obterTamanhoZip(zipUrl);
                pesos.push([nomePacote, versaoServidor, zipUrl, tamanho]);
                totalBytesGeral += tamanho;
            }

            // Se por algum motivo nenhum HEAD retornou tamanho (ex: algo
            // bloqueando HEAD), cai num peso igual por pacote — a barra
            // ainda avança de forma proporcional, só não tão precisa.
            const pesoIgualFallback = totalBytesGeral === 0;
            if (pesoIgualFallback) {
                pesos.forEach(p => { p[3] = 1; });
                totalBytesGeral = pesos.length;
            }

            const prosseguir = await pedirConfirmacaoDownload(totalBytesGeral);
            if (!prosseguir) {
                tentarFecharApp();
                return; // não libera as imagens nem chama finalizarAssetsReady
            }

            setWarningVisible(true);
            window.addEventListener('beforeunload', beforeUnloadHandler);
            avisoAtivo = true;

            // Download pesa 90% do peso do pacote na barra geral, extração
            // pesa os 10% finais — a extração é bem mais rápida que a rede
            // na prática, então isso reflete melhor onde o tempo é gasto.
            let bytesConcluidosAntes = 0;
            for (const [nomePacote, versaoServidor, zipUrl, tamanhoPacote] of pesos) {
                let blob = await downloadZipWithProgress(zipUrl, nomePacote, (recebidos, totalResp) => {
                    const tamanhoReal = pesoIgualFallback ? 0 : (totalResp || tamanhoPacote);
                    const fracao = pesoIgualFallback
                        ? 0 // sem tamanho real, só avança na extração (abaixo)
                        : (tamanhoReal ? recebidos / tamanhoReal : 0);
                    const bytesEquivalentes = tamanhoPacote * fracao * 0.9;
                    setProgressBarPercent((bytesConcluidosAntes + bytesEquivalentes) / totalBytesGeral * 100);
                });

                await extractZipToCache(blob, cache, nomePacote, (concluidos, totalArquivos) => {
                    const fracaoExtracao = totalArquivos ? concluidos / totalArquivos : 1;
                    const bytesEquivalentes = tamanhoPacote * (0.9 + fracaoExtracao * 0.1);
                    setProgressBarPercent((bytesConcluidosAntes + bytesEquivalentes) / totalBytesGeral * 100);
                });

                await setStoredVersion(cache, nomePacote, versaoServidor);

                bytesConcluidosAntes += tamanhoPacote;
                setProgressBarPercent(bytesConcluidosAntes / totalBytesGeral * 100);

                console.log(`🎉 Pacote [${nomePacote}] atualizado para ${versaoServidor}!`);
                blob = null; // ajuda o GC a liberar a RAM antes do próximo pacote
            }

            setProgressBarPercent(100);
            setStatusText('Download concluído!');
        }

        promoverAssetsAdiados();
        finalizarAssetsReady();

    } catch (error) {
        console.error('❌ Erro ao atualizar assets:', error);
        setStatusText('Erro ao baixar arquivos. Tentando novamente em instantes...');
        // Não libera as imagens nem remove o aviso — tenta o processo inteiro
        // de novo automaticamente em vez de exigir que o jogador recarregue a página.
        setTimeout(baixarEExtrairAssets, 5000);
        return;
    } finally {
        if (avisoAtivo) {
            window.removeEventListener('beforeunload', beforeUnloadHandler);
            setWarningVisible(false);
        }
    }
}

function finalizarAssetsReady() {
    window.assetsReady = true;
    window.__resolveAssetsReady();
    window.dispatchEvent(new Event('aden-assets-ready'));

    // Só a partir daqui é seguro medir o carregamento das imagens/áudio/vídeo,
    // porque só agora todas elas têm de fato um src apontando pra algo que
    // já existe no cache.
    iniciarMonitoramentoDeRecursos();
}

// =====================================================================
// Lógica original: acompanha o carregamento de <img>/<audio>/<video> e
// libera a tela de loading quando tudo tiver carregado E o script.js
// tiver terminado a verificação de autenticação.
// =====================================================================
function iniciarMonitoramentoDeRecursos() {
    const loadingOverlay = document.getElementById('loading-overlay');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    const resources = document.querySelectorAll('img, audio, video');
    const totalResources = resources.length;
    let loadedResources = 0;
    let resourcesLoaded = false;

    window.tryHideLoadingScreen = function () {
        if (resourcesLoaded && window.authCheckComplete && document.readyState === 'complete') {
            loadingOverlay.classList.add('hidden');
            setTimeout(() => {
                loadingOverlay.remove();
            }, 500);
        }
    };

    function updateProgress() {
        loadedResources++;
        const progressPercentage = Math.round((loadedResources / totalResources) * 100);

        if (progressBar) progressBar.style.width = `${progressPercentage}%`;
        if (progressText) progressText.innerText = `${progressPercentage}%`;

        if (loadedResources === totalResources) {
            resourcesLoaded = true;
            window.tryHideLoadingScreen();
        }
    }

    window.addEventListener('load', () => {
        if (progressBar) progressBar.style.width = `100%`;
        if (progressText) progressText.innerText = `100%`;
        resourcesLoaded = true;
        window.tryHideLoadingScreen();
    });

    if (totalResources === 0) {
        resourcesLoaded = true;
        window.tryHideLoadingScreen();
    } else {
        resources.forEach(resource => {
            if (resource.complete || resource.readyState >= 2) {
                updateProgress();
            } else {
                resource.addEventListener('load', updateProgress);
                resource.addEventListener('error', updateProgress);
            }
        });
    }

    setTimeout(() => {
        if (!resourcesLoaded) {
            if (progressBar) progressBar.style.width = `100%`;
            if (progressText) progressText.innerText = `100%`;
            resourcesLoaded = true;
            window.tryHideLoadingScreen();
        }
    }, 4000);
}
