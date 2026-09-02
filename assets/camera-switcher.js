/**
 * Gestionnaire de camera pour AR.js
 * - Detection et bascule fiable entre toutes les cameras disponibles
 * - Support multi-capteurs Android (ROG Phone, Samsung, Pixel, etc.)
 * - Force l'affichage du flux natif sans rognage (object-fit: contain)
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

  // Force le flux et le canvas à respecter les bords sans rognage
  function enforceNativeFit() {
    const { video, canvas } = getElements();
    if (video) {
      video.style.setProperty('width', '100vw', 'important');
      video.style.setProperty('height', '100vh', 'important');
      video.style.setProperty('object-fit', 'contain', 'important');
      video.style.setProperty('margin', '0px', 'important');
      video.style.setProperty('top', '0px', 'important');
      video.style.setProperty('left', '0px', 'important');
      video.style.setProperty('position', 'absolute', 'important');
    }
    if (canvas) {
      canvas.style.setProperty('width', '100vw', 'important');
      canvas.style.setProperty('height', '100vh', 'important');
      canvas.style.setProperty('object-fit', 'contain', 'important');
      canvas.style.setProperty('margin', '0px', 'important');
      canvas.style.setProperty('top', '0px', 'important');
      canvas.style.setProperty('left', '0px', 'important');
      canvas.style.setProperty('position', 'absolute', 'important');
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
      console.warn("Erreur enumeration cameras:", e);
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
      btn.textContent = `Changer de camera (${currentDeviceIndex + 1}/${videoDevices.length} : ${label})`;
    }
  }

  // Bascule vers la caméra suivante avec libération propre Camera2 sur Android
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
      // 1. Arret complet des flux existants
      if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
        video.srcObject = null;
      }

      // 2. Delai de 250ms pour liberer le materiel sur Android
      await new Promise(r => setTimeout(r, 250));

      currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
      const targetDevice = videoDevices[currentDeviceIndex];

      let newStream = null;

      // Tentative 1 : deviceId exact sans forcer de ratio rigide
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: { exact: targetDevice.deviceId }
          }
        });
      } catch (err1) {
        console.warn("Tentative 1 echouee, tentative 2 (ideal):", err1);
        try {
          newStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              deviceId: targetDevice.deviceId
            }
          });
        } catch (err2) {
          console.warn("Tentative 2 echouee, tentative 3 (facingMode):", err2);
          const isFront = currentDeviceIndex === 0;
          newStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: isFront ? "user" : "environment"
            }
          });
        }
      }

      if (!newStream) throw new Error("Flux camera indisponible.");

      video.srcObject = newStream;
      await video.play();

      setTimeout(() => {
        enforceNativeFit();
        window.dispatchEvent(new Event('resize'));
      }, 200);

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
        enforceNativeFit();
      } catch (e2) {}
      updateButtonText();
    } finally {
      isSwitching = false;
    }
  }

  function init() {
    const btnSwitch = document.getElementById('btnSwitchCamera');
    if (btnSwitch) btnSwitch.addEventListener('click', switchCamera);

    // Observer l'arrivee du flux et forcer le cadrage contain
    const checkInterval = setInterval(() => {
      const { video } = getElements();
      if (video && video.srcObject) {
        clearInterval(checkInterval);
        const track = video.srcObject.getVideoTracks()[0];
        if (track) {
          updateDeviceList(track);
        }
        enforceNativeFit();
      }
    }, 300);

    setTimeout(() => clearInterval(checkInterval), 12000);

    window.addEventListener('resize', enforceNativeFit);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.cameraSwitcher = {
    switchCamera,
    enforceNativeFit
  };
})();
