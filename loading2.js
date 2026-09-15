document.addEventListener('DOMContentLoaded', () => {
  const loadingOverlay = document.getElementById('loading-overlay');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');

  const resources = document.querySelectorAll('img, audio, video');
  const totalResources = resources.length;
  let loadedResources = 0;
  
  // Condição para garantir que a barra de progresso chegue a 100%
  let isProgressAt100 = false;
  
  // Função para esconder a tela
  function hideLoadingScreen() {
    loadingOverlay.classList.add('hidden');
    setTimeout(() => {
      loadingOverlay.remove();
    }, 500);
  }
  
  // Função para verificar se a tela pode ser escondida
  function checkCompletion() {
    // Esconde a tela se a barra de progresso já chegou a 100%
    // E o evento 'onload' foi disparado (ou seja, a página está pronta)
    if (isProgressAt100 && document.readyState === 'complete') {
      hideLoadingScreen();
    }
  }

  function updateProgress() {
    loadedResources++;
    const progressPercentage = Math.round((loadedResources / totalResources) * 100);
    progressBar.style.width = `${progressPercentage}%`;
    progressText.innerText = `${progressPercentage}%`;

    if (loadedResources === totalResources) {
      isProgressAt100 = true;
      checkCompletion();
    }
  }

  // Monitora o evento 'onload' da janela
  window.addEventListener('load', () => {
    checkCompletion();
  });

  // Se não houver recursos, esconde a tela no 'onload'
  if (totalResources === 0) {
    window.addEventListener('load', hideLoadingScreen);
    return;
  }
  
  // Monitora os recursos
  resources.forEach(resource => {
    if (resource.complete || resource.readyState >= 2) {
      updateProgress();
    } else {
      resource.addEventListener('load', updateProgress);
      resource.addEventListener('error', updateProgress);
    }
  });

  // 🔒 Timeout de segurança: força 100% após 5 segundos
  setTimeout(() => {
    if (!isProgressAt100) {
      progressBar.style.width = `100%`;
      progressText.innerText = `100%`;
      isProgressAt100 = true;
      checkCompletion();
    }
  }, 3000);

});
