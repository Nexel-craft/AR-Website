/**
 * Gestionnaire de camera, zoom et calibration pour AR.js
 * - Détection et bascule entre toutes les caméras disponibles (videoinput)
 * - Correction du délai de libération matériel Camera2 sur Android / Chrome Mobile
 * - Gestion du Zoom + / Zoom - (matériel via WebRTC et visuel via CSS)
 * - Mode de cadrage : Remplir l'écran (cover) ou Affichage complet sans rognage (contain)
 */

(function () {
  let videoDevices = [];
  let currentDeviceIndex = 0;
  let isSwitching = false;
  let currentHardwareZoom = 1.0;
  let currentVisualZoom = 1.0;
  let isContainMode = false;
  let zoomCapabilities = null;

  function getElements() {
    const video = document.querySelector('#arjs-video') || document.querySelector('video');
    const canvas = document.querySelector('.a-canvas') || document.querySelector('canvas');
    return { video, canvas };
  }

  function applyTransformStyles() {
    const { video, canvas } = getElements();
    if (!video) return;

    if (isContainMode) {
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
      video.style.removeProperty('object-fit');
      if (canvas) canvas.style.removeProperty('object-fit');
    }

    const scaleStr = `scale(${currentVisualZoom})`;
    video.style.transform = scaleStr;
    video.style.transformOrigin = 'center center';

    if (canvas) {
      canvas.style.transform = scaleStr;
      canvas.style.transformOrigin = 'center center';
    }

    updateZoomDisplay();
  }

  function updateZoomDisplay() {
    const zoomText = document.getElementById('zoomLevelText');
    if (zoomText) {
      const displayVal = (currentVisualZoom * currentHardwareZoom).toFixed(1);
      zoomText.textContent = `${displayVal}x`;
    }
  }

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
      console.warn("Hardware zoom non supporté:", e);
    }
    return false;
  }

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

  // Bascule fiable entre caméras pour Chrome Android et tous navigateurs
  async function switchCamera() {
    if (isSwitching) return;
    if (videoDevices.length <= 1) {
      await updateDeviceList();
      if (videoDevices.length <= 1) {
        alert("Une seule camera est detectee.");
        return;
      }
    }

    const { video } = getElements();
    if (!video) return;

    isSwitching = true;
    const btn = document.getElementById('btnSwitchCamera');
    if (btn) btn.textContent = "Changement en cours...";

    try {
      // 1. Arrêter proprement tous les flux existants
      if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
        video.srcObject = null;
      }

      // 2. Délai indispensable sur Android pour libérer le verrou matériel Camera2
      await new Promise(r => setTimeout(r, 250));

      currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
      const targetDevice = videoDevices[currentDeviceIndex];

      let newStream = null;

      // Tentative 1 : Sélection directe par deviceId sans contraindre la résolution
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: { exact: targetDevice.deviceId }
          }
        });
      } catch (err1) {
        console.warn("Tentative 1 echouee, tentative 2 (ideal):", err1);
        // Tentative 2 : deviceId ideal
        try {
          newStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              deviceId: targetDevice.deviceId
            }
          });
        } catch (err2) {
          console.warn("Tentative 2 echouee, tentative 3 (facingMode):", err2);
          // Tentative 3 : alternance facingMode
          const isFront = currentDeviceIndex === 0;
          newStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: isFront ? "user" : "environment"
            }
          });
        }
      }

      if (!newStream) {
        throw new Error("Impossible d'obtenir un flux video.");
      }

      video.srcObject = newStream;
      await video.play();

      // Notifier AR.js du changement de résolution du flux
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 300);

      currentHardwareZoom = 1.0;
      await applyHardwareZoom(1.0);
      applyTransformStyles();
      updateButtonText();
    } catch (err) {
      console.error("Erreur bascule camera finale:", err);
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

  async function zoomOut() {
    let hwApplied = false;
    if (zoomCapabilities && currentHardwareZoom > (zoomCapabilities.min || 1.0)) {
      const step = zoomCapabilities.step || 0.2;
      hwApplied = await applyHardwareZoom(currentHardwareZoom - step);
    }
    if (!hwApplied) {
      currentVisualZoom = Math.max(0.4, Math.round((currentVisualZoom - 0.15) * 100) / 100);
    }
    applyTransformStyles();
  }

  async function zoomIn() {
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
    if (!hwApplied) {
      currentVisualZoom = Math.min(3.0, Math.round((currentVisualZoom + 0.2) * 100) / 100);
    }
    applyTransformStyles();
  }

  function toggleFitMode() {
    isContainMode = !isContainMode;
    const btn = document.getElementById('btnFitMode');
    if (btn) {
      btn.textContent = isContainMode ? "Cadrage : Entier (non rogne)" : "Cadrage : Remplir";
    }
    applyTransformStyles();
  }

  function init() {
    const btnSwitch = document.getElementById('btnSwitchCamera');
    if (btnSwitch) btnSwitch.addEventListener('click', switchCamera);

    const btnOut = document.getElementById('btnZoomOut');
    if (btnOut) btnOut.addEventListener('click', zoomOut);

    const btnIn = document.getElementById('btnZoomIn');
    if (btnIn) btnIn.addEventListener('click', zoomIn);

    const btnFit = document.getElementById('btnFitMode');
    if (btnFit) btnFit.addEventListener('click', toggleFitMode);

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
