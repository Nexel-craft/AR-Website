/**
 * Gestionnaire de camera, zoom et calibration pour AR.js
 * - Détection et bascule entre toutes les caméras disponibles (videoinput)
 * - Gestion du Zoom + / Zoom - (matériel via WebRTC et visuel via CSS)
 * - Mode de cadrage : Remplir l'écran (cover) ou Affichage complet sans rognage (contain)
 * - Résout le problème de zoom excessif sur écrans allongés (ROG Phone, Samsung, 20:9)
 */

(function () {
  let videoDevices = [];
  let currentDeviceIndex = 0;
  let isSwitching = false;
  let currentHardwareZoom = 1.0;
  let currentVisualZoom = 1.0;
  let isContainMode = false;
  let zoomCapabilities = null;

  // Récupère l'élément vidéo et le canvas
  function getElements() {
    const video = document.querySelector('#arjs-video') || document.querySelector('video');
    const canvas = document.querySelector('.a-canvas') || document.querySelector('canvas');
    return { video, canvas };
  }

  // Applique les styles de zoom et cadrage sur la vidéo et le canvas WebGL
  function applyTransformStyles() {
    const { video, canvas } = getElements();
    if (!video) return;

    if (isContainMode) {
      // Mode ajusté : la totalité du capteur caméra est visible sans rognage
      video.style.setProperty('width', '100vw', 'important');
      video.style.setProperty('height', '100vh', 'important');
      video.style.setProperty('object-fit', 'contain', 'important');
      video.style.setProperty('margin', '0px', 'important');
      video.style.setProperty('top', '0px', 'important');
      video.style.setProperty('left', '0px', 'important');

      if (canvas) {
        canvas.style.setProperty('width', '100vw', 'important');
        canvas.style.setProperty('height', '100vh', 'important');
        canvas.style.setProperty('object-fit', 'contain', 'important');
        canvas.style.setProperty('margin', '0px', 'important');
        canvas.style.setProperty('top', '0px', 'important');
        canvas.style.setProperty('left', '0px', 'important');
      }
    } else {
      // Mode normal : on rétablit le comportement AR.js tout en appliquant l'échelle visuelle
      video.style.removeProperty('object-fit');
      if (canvas) canvas.style.removeProperty('object-fit');
    }

    // Applique le zoom visuel (CSS transform)
    const scaleStr = `scale(${currentVisualZoom})`;
    video.style.transform = scaleStr;
    video.style.transformOrigin = 'center center';

    if (canvas) {
      canvas.style.transform = scaleStr;
      canvas.style.transformOrigin = 'center center';
    }

    updateZoomDisplay();
  }

  // Met à jour l'affichage textuel du zoom
  function updateZoomDisplay() {
    const zoomText = document.getElementById('zoomLevelText');
    if (zoomText) {
      const displayVal = (currentVisualZoom * currentHardwareZoom).toFixed(1);
      zoomText.textContent = `${displayVal}x`;
    }
  }

  // Applique le zoom matériel (WebRTC MediaTrackConstraints) si supporté
  async function applyHardwareZoom(targetZoom) {
    const { video } = getElements();
    if (!video || !video.srcObject) return false;
    const track = video.srcObject.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== 'function') return false;

    try {
      const caps = track.getCapabilities();
      if (caps.zoom) {
        zoomCapabilities = caps.zoom;
        const minZ = caps.zoom.min !== undefined ? caps.zoom.min : 1;
        const maxZ = caps.zoom.max !== undefined ? caps.zoom.max : 5;
        const clampedZoom = Math.max(minZ, Math.min(maxZ, targetZoom));
        
        await track.applyConstraints({
          advanced: [{ zoom: clampedZoom }]
        });
        currentHardwareZoom = clampedZoom;
        return true;
      }
    } catch (e) {
      console.warn("Hardware zoom non supporté ou refusé:", e);
    }
    return false;
  }

  // Énumération des caméras
  async function updateDeviceList(activeTrack) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      videoDevices = devices.filter(d => d.kind === 'videoinput');

      if (activeTrack && videoDevices.length > 0) {
        const settings = typeof activeTrack.getSettings === 'function' ? activeTrack.getSettings() : {};
        const activeDeviceId = settings.deviceId;
        const foundIdx = videoDevices.findIndex(d => d.deviceId === activeDeviceId);
        if (foundIdx !== -1) currentDeviceIndex = foundIdx;
      }
      updateButtonText();
    } catch (e) {
      console.warn("Erreur énumération caméras:", e);
    }
  }

  function updateButtonText() {
    const btn = document.getElementById('btnSwitchCamera');
    if (!btn) return;
    if (videoDevices.length <= 1) {
      btn.textContent = "Changer camera (1 detectee)";
    } else {
      const dev = videoDevices[currentDeviceIndex];
      const label = dev && dev.label ? dev.label.substring(0, 16) : `Camera ${currentDeviceIndex + 1}`;
      btn.textContent = `Camera (${currentDeviceIndex + 1}/${videoDevices.length} : ${label})`;
    }
  }

  // Bascule vers la caméra suivante
  async function switchCamera() {
    if (isSwitching) return;
    if (videoDevices.length <= 1) {
      await updateDeviceList();
      if (videoDevices.length <= 1) {
        alert("Une seule camera est detectee sur cet appareil.");
        return;
      }
    }

    const { video } = getElements();
    if (!video) return;

    isSwitching = true;
    const btn = document.getElementById('btnSwitchCamera');
    if (btn) btn.textContent = "Changement en cours...";

    try {
      if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
      }

      currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
      const targetDevice = videoDevices[currentDeviceIndex];

      // Requête 16:9 idéale (1280x720) pour éviter le rognage 4:3 sur écrans longs
      const constraints = {
        audio: false,
        video: {
          deviceId: { exact: targetDevice.deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newTrack = newStream.getVideoTracks()[0];
      
      video.srcObject = newStream;
      await video.play();

      // Réinitialiser le zoom sur la nouvelle caméra
      currentHardwareZoom = 1.0;
      await applyHardwareZoom(1.0);
      applyTransformStyles();
      updateButtonText();
    } catch (err) {
      console.error("Erreur bascule camera:", err);
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'environment' }
        });
        video.srcObject = fallbackStream;
        await video.play();
      } catch (e2) {}
      updateButtonText();
    } finally {
      isSwitching = false;
    }
  }

  // Action Zoom - (dézoomer)
  async function zoomOut() {
    let hwApplied = false;
    if (zoomCapabilities && currentHardwareZoom > (zoomCapabilities.min || 1.0)) {
      const step = zoomCapabilities.step || 0.2;
      hwApplied = await applyHardwareZoom(currentHardwareZoom - step);
    }
    // Si pas de zoom matériel ou déjà au minimum, on dézoome visuellement (jusqu'à 0.4x)
    if (!hwApplied) {
      currentVisualZoom = Math.max(0.4, Math.round((currentVisualZoom - 0.15) * 100) / 100);
    }
    applyTransformStyles();
  }

  // Action Zoom + (zoomer)
  async function zoomIn() {
    // Si on avait un dézoom visuel (< 1.0), on le remonte d'abord vers 1.0
    if (currentVisualZoom < 1.0) {
      currentVisualZoom = Math.min(1.0, Math.round((currentVisualZoom + 0.15) * 100) / 100);
      applyTransformStyles();
      return;
    }

    let hwApplied = false;
    if (zoomCapabilities) {
      const maxZ = zoomCapabilities.max || 5.0;
      const step = zoomCapabilities.step || 0.2;
      if (currentHardwareZoom < maxZ) {
        hwApplied = await applyHardwareZoom(currentHardwareZoom + step);
      }
    }
    // Si pas de zoom matériel, on zoome visuellement
    if (!hwApplied) {
      currentVisualZoom = Math.min(3.0, Math.round((currentVisualZoom + 0.2) * 100) / 100);
    }
    applyTransformStyles();
  }

  // Bascule du mode de cadrage (Remplir vs Entier sans rognage)
  function toggleFitMode() {
    isContainMode = !isContainMode;
    const btn = document.getElementById('btnFitMode');
    if (btn) {
      btn.textContent = isContainMode ? "Cadrage : Entier (non rogne)" : "Cadrage : Remplir";
    }
    applyTransformStyles();
  }

  // Initialisation des écouteurs
  function init() {
    const btnSwitch = document.getElementById('btnSwitchCamera');
    if (btnSwitch) btnSwitch.addEventListener('click', switchCamera);

    const btnOut = document.getElementById('btnZoomOut');
    if (btnOut) btnOut.addEventListener('click', zoomOut);

    const btnIn = document.getElementById('btnZoomIn');
    if (btnIn) btnIn.addEventListener('click', zoomIn);

    const btnFit = document.getElementById('btnFitMode');
    if (btnFit) btnFit.addEventListener('click', toggleFitMode);

    // Surveillance de l'initialisation de la vidéo par AR.js
    const checkInterval = setInterval(() => {
      const { video } = getElements();
      if (video && video.srcObject) {
        clearInterval(checkInterval);
        const track = video.srcObject.getVideoTracks()[0];
        if (track) {
          applyHardwareZoom(1.0);
          updateDeviceList(track);
        }
        applyTransformStyles();
      }
    }, 400);

    setTimeout(() => clearInterval(checkInterval), 12000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.cameraSwitcher = {
    switchCamera,
    zoomIn,
    zoomOut,
    toggleFitMode
  };
})();
