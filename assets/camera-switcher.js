/**
 * Gestionnaire de camera pour AR.js
 * - Détection et bascule entre toutes les caméras disponibles (videoinput)
 * - Force l'affichage natif sans aucun rognage (object-fit: contain) pour éliminer le zoom artificiel
 */

(function () {
  let videoDevices = [];
  let currentDeviceIndex = 0;
  let isSwitching = false;

  function getElements() {
    const video = document.querySelector('#arjs-video') || document.querySelector('video');
    const canvas = document.querySelector('.a-canvas') || document.querySelector('canvas');
    return { video, canvas };
  }

  // Force le flux vidéo et le canvas WebGL à être collés aux bords sans rognage
  function applyUncroppedStyles() {
    const { video, canvas } = getElements();
    if (!video) return;

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

  // Bascule fiable entre caméras avec délai pour Android Camera2
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
    if (btn) btn.textContent = "Changement...";

    try {
      if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
        video.srcObject = null;
      }

      // Délai indispensable sur Android pour libérer le matériel
      await new Promise(r => setTimeout(r, 250));

      currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
      const targetDevice = videoDevices[currentDeviceIndex];

      let newStream = null;

      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: { exact: targetDevice.deviceId } }
        });
      } catch (err1) {
        try {
          newStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { deviceId: targetDevice.deviceId }
          });
        } catch (err2) {
          const isFront = currentDeviceIndex === 0;
          newStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: isFront ? "user" : "environment" }
          });
        }
      }

      if (!newStream) throw new Error("Flux non obtenu");

      video.srcObject = newStream;
      await video.play();

      setTimeout(() => {
        applyUncroppedStyles();
        window.dispatchEvent(new Event('resize'));
      }, 300);

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
      applyUncroppedStyles();
    }
  }

  function init() {
    const btnSwitch = document.getElementById('btnSwitchCamera');
    if (btnSwitch) btnSwitch.addEventListener('click', switchCamera);

    const checkInterval = setInterval(() => {
      const { video } = getElements();
      if (video && video.srcObject) {
        clearInterval(checkInterval);
        const track = video.srcObject.getVideoTracks()[0];
        if (track) updateDeviceList(track);
        applyUncroppedStyles();
      }
    }, 300);

    setTimeout(() => clearInterval(checkInterval), 10000);
    window.addEventListener('resize', applyUncroppedStyles);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.cameraSwitcher = { switchCamera, applyUncroppedStyles };
})();
