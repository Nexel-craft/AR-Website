/**
 * Gestionnaire de camera et de cadrage universel pour AR.js
 * - Maintien strict du flux natif sans aucun rognage (object-fit: contain)
 * - Synchronisation au pixel pres du canvas Three.js avec la resolution reelle de la camera
 * - Bascule fiable entre tous les capteurs (Android Camera2 / ROG Phone / PC)
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

  // Synchronise la taille du buffer interne du canvas sur les dimensions reelles de la video
  // pour que object-fit: contain produise un alignement 3D parfait
  function syncCanvasBuffer() {
    const { video, canvas } = getElements();
    if (!video || !canvas) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw;
      canvas.height = vh;
      const scene = document.querySelector('a-scene');
      if (scene && scene.renderer) {
        scene.renderer.setSize(vw, vh, false);
      }
    }
  }

  // Fournit le rectangle de rendu exact calcule par object-fit: contain sur l'ecran
  window.getARViewport = function () {
    const { video } = getElements();
    const sw = window.innerWidth;
    const sh = window.innerHeight;

    if (!video || !video.videoWidth || !video.videoHeight) {
      return { left: 0, top: 0, width: sw, height: sh };
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(sw / vw, sh / vh);
    const rw = vw * scale;
    const rh = vh * scale;
    const ox = (sw - rw) / 2;
    const oy = (sh - rh) / 2;

    return { left: ox, top: oy, width: rw, height: rh };
  };

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
      if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
        video.srcObject = null;
      }

      await new Promise(r => setTimeout(r, 250));

      currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
      const targetDevice = videoDevices[currentDeviceIndex];

      let newStream = null;

      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: { exact: targetDevice.deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
      } catch (err1) {
        console.warn("Tentative 1 echouee, tentative 2:", err1);
        try {
          newStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              deviceId: targetDevice.deviceId,
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }
          });
        } catch (err2) {
          console.warn("Tentative 2 echouee, tentative 3 basique:", err2);
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

      video.onloadedmetadata = function () {
        syncCanvasBuffer();
        window.dispatchEvent(new Event('resize'));
      };

      setTimeout(() => {
        syncCanvasBuffer();
        window.dispatchEvent(new Event('resize'));
      }, 300);

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
        syncCanvasBuffer();
      } catch (e2) {}
      updateButtonText();
    } finally {
      isSwitching = false;
    }
  }

  function init() {
    const btnSwitch = document.getElementById('btnSwitchCamera');
    if (btnSwitch) btnSwitch.addEventListener('click', switchCamera);

    const checkInterval = setInterval(() => {
      const { video, canvas } = getElements();
      if (video && video.srcObject && canvas) {
        clearInterval(checkInterval);
        const track = video.srcObject.getVideoTracks()[0];
        if (track) {
          updateDeviceList(track);
        }
        video.addEventListener('loadedmetadata', syncCanvasBuffer);
        video.addEventListener('resize', syncCanvasBuffer);
        syncCanvasBuffer();
      }
    }, 200);

    setTimeout(() => clearInterval(checkInterval), 10000);

    window.addEventListener('resize', () => {
      setTimeout(syncCanvasBuffer, 50);
    });
    window.addEventListener('orientationchange', () => {
      setTimeout(syncCanvasBuffer, 300);
    });

    // Boucle de maintien de synchronisation du buffer (evite que A-Frame ecrase les dimensions)
    setInterval(syncCanvasBuffer, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.cameraSwitcher = {
    switchCamera,
    syncCanvasBuffer
  };
})();
