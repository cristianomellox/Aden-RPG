document.addEventListener('DOMContentLoaded', () => {
  const loadingOverlay = document.getElementById('loading-overlay');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');

  const resources = document.querySelectorAll('img, audio, video');
  const totalResources = resources.length;
  let loadedResources = 0;
  
  // Flags de controle
  let resourcesLoaded = false;
  
  // Função global para tentar esconder a tela
  // O script.js vai chamar isso quando o login for verificado
  window.tryHideLoadingScreen = function() {
    // Só esconde se:
    // 1. Os recursos (imagens) carregaram 
    // 2. A verificação de Auth do script.js terminou (window.authCheckComplete)
    // 3. O documento está pronto
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
      window.tryHideLoadingScreen(); // Tenta esconder, mas vai esperar o Auth
    }
  }

  // Monitora o evento 'onload' da janela
  window.addEventListener('load', () => {
    // Força 100% visualmente se tudo carregou
    if(progressBar) progressBar.style.width = `100%`;
    if(progressText) progressText.innerText = `100%`;
    resourcesLoaded = true;
    window.tryHideLoadingScreen();
  });

  // Se não houver recursos, marca como carregado imediatamente
  if (totalResources === 0) {
    resourcesLoaded = true;
  } else {
    // Monitora os recursos
    resources.forEach(resource => {
      if (resource.complete || resource.readyState >= 2) {
        updateProgress();
      } else {
        resource.addEventListener('load', updateProgress);
        resource.addEventListener('error', updateProgress);
      }
    });
  }

  // 🔒 Timeout de segurança: força o desbloqueio visual após 4 segundos
  // caso algo trave, mas ainda respeita o Auth se possível
  setTimeout(() => {
    if (!resourcesLoaded) {
      if(progressBar) progressBar.style.width = `100%`;
      if(progressText) progressText.innerText = `100%`;
      resourcesLoaded = true;
      window.tryHideLoadingScreen();
    }
  }, 4000);

});