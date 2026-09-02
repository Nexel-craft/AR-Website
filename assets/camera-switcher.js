/**
 * Gestionnaire de sélection et bascule des caméras pour AR.js
 * - Détecte toutes les caméras vidéo disponibles (videoinput)
 * - Permet de faire défiler / varier les caméras via un bouton
 * - Applique un zoom x1 par défaut si l'API le supporte
 */

(function () {
  let videoDevices = [];
  let currentDeviceIndex = 0;
  let isSwitching = false;

  function applyDefaultZoom(track) {
    if (!track) return;
    try {
      if (typeof track.getCapabilities === 'function') {
        const caps = track.getCapabilities();
        if (caps.zoom) {
          const minZoom = caps.zoom.min !== undefined ? caps.zoom.min : 1;
          const targetZoom = Math.max(minZoom, 1);
          track.applyConstraints({
            advanced: [{ zoom: targetZoom }]
          }).catch(function (err) {
            console.warn("Impossible d'appliquer le zoom x1:", err);
          });
        }
      }
    } catch (e) {
      console.warn("Erreur getCapabilities zoom:", e);
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
        if (foundIdx !== -1) {
          currentDeviceIndex = foundIdx;
        }
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
      btn.textContent = "Changer de camera (1 detectee)";
    } else {
      const dev = videoDevices[currentDeviceIndex];
      const label = dev && dev.label ? dev.label.substring(0, 18) : `Camera ${currentDeviceIndex + 1}`;
      btn.textContent = `Changer camera (${currentDeviceIndex + 1}/${videoDevices.length} : ${label})`;
    }
  }

  async function switchCamera() {
    if (isSwitching) return;
    if (videoDevices.length <= 1) {
      await updateDeviceList();
      if (videoDevices.length <= 1) {
        alert("Une seule camera est detectee sur cet appareil.");
        return;
      }
    }

    const video = document.querySelector('#arjs-video') || document.querySelector('video');
    if (!video) {
      alert("Flux video non pret.");
      return;
    }

    isSwitching = true;
    const btn = document.getElementById('btnSwitchCamera');
    if (btn) btn.textContent = "Changement en cours...";

    try {
      // 1. Arrêter le flux actuel
      if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
      }

      // 2. Sélectionner la caméra suivante
      currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
      const targetDevice = videoDevices[currentDeviceIndex];

      // 3. Demander le nouveau flux avec zoom x1
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
      applyDefaultZoom(newTrack);

      video.srcObject = newStream;
      await video.play();

      updateButtonText();
    } catch (err) {
      console.error("Erreur bascule camera:", err);
      // Tentative de fallback
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'environment' }
        });
        video.srcObject = fallbackStream;
        await video.play();
      } catch (e2) {
        console.error("Erreur fallback:", e2);
      }
      updateButtonText();
    } finally {
      isSwitching = false;
    }
  }

  function initSwitcher() {
    const btn = document.getElementById('btnSwitchCamera');
    if (btn) {
      btn.addEventListener('click', switchCamera);
    }

    // Observer l'apparition du flux vidéo AR.js
    const checkVideo = setInterval(() => {
      const video = document.querySelector('#arjs-video') || document.querySelector('video');
      if (video && video.srcObject) {
        clearInterval(checkVideo);
        const track = video.srcObject.getVideoTracks()[0];
        if (track) {
          applyDefaultZoom(track);
          updateDeviceList(track);
        }
      }
    }, 400);

    // Arrêt après 10s si non trouvé
    setTimeout(() => clearInterval(checkVideo), 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSwitcher);
  } else {
    initSwitcher();
  }

  window.switchCamera = switchCamera;
})();
