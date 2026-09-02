/**
 * Gestionnaire de camera et calibration de cadrage pour AR.js
 * - Detection et bascule fiable entre toutes les cameras (multi-capteurs Android)
 * - Calibrage haute resolution : limite l'echelle a 1080p pour eviter l'explosion d'echelle (flux 4k/8k natif)
 * - Cadrage natif sans aucun rognage (contain) avec alignement 3D parfait pixel-par-pixel
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

  // Calcule et applique le cadrage complet (contain) sans rognage tout en conservant l'alignement 3D
  function enforceNativeFit() {
    const { video, canvas } = getElements();
    if (!video) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) {
      setTimeout(enforceNativeFit, 100);
      return;
    }

    const sw = window.innerWidth;
    const sh = window.innerHeight;

    const videoAspect = vw / vh;
    const screenAspect = sw / sh;

    let targetWidth, targetHeight, marginLeft, marginTop;

    if (screenAspect > videoAspect) {
      // Ecran plus large que la video (ex: PC 16:9 ou ultrawide) -> barres noires laterales
      targetHeight = sh;
      targetWidth = targetHeight * videoAspect;
      marginLeft = (sw - targetWidth) / 2;
      marginTop = 0;
    } else {
      // Ecran plus haut que la video (ex: mobile portrait 20:9) -> barres noires haut/bas
      targetWidth = sw;
      targetHeight = targetWidth / videoAspect;
      marginLeft = 0;
      marginTop = (sh - targetHeight) / 2;
    }

    const wStr = Math.round(targetWidth) + 'px';
    const hStr = Math.round(targetHeight) + 'px';
    const mlStr = Math.round(marginLeft) + 'px';
    const mtStr = Math.round(marginTop) + 'px';

    // Application stricte et identique a la video et au canvas Three.js
    video.style.setProperty('width', wStr, 'important');
    video.style.setProperty('height', hStr, 'important');
    video.style.setProperty('margin-left', mlStr, 'important');
    video.style.setProperty('margin-top', mtStr, 'important');
    video.style.setProperty('top', '0px', 'important');
    video.style.setProperty('left', '0px', 'important');
    video.style.setProperty('position', 'absolute', 'important');
    video.style.removeProperty('object-fit');

    if (canvas) {
      canvas.style.setProperty('width', wStr, 'important');
      canvas.style.setProperty('height', hStr, 'important');
      canvas.style.setProperty('margin-left', mlStr, 'important');
      canvas.style.setProperty('margin-top', mtStr, 'important');
      canvas.style.setProperty('top', '0px', 'important');
      canvas.style.setProperty('left', '0px', 'important');
      canvas.style.setProperty('position', 'absolute', 'important');
      canvas.style.removeProperty('object-fit');
    }

    // Aligner le buffer de rendu Three.js sur le ratio de la video
    const scene = document.querySelector('a-scene');
    if (scene && scene.renderer) {
      scene.renderer.setSize(Math.round(targetWidth), Math.round(targetHeight), false);
    }
  }

  // Fournit les coordonnees du rectangle video pour la projection 2D (ex: zone de clic)
  window.getARViewport = function() {
    const { video } = getElements();
    if (!video || !video.videoWidth) {
      return { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
    }
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sw = window.innerWidth;
    const sh = window.innerHeight;
    const videoAspect = vw / vh;
    const screenAspect = sw / sh;

    if (screenAspect > videoAspect) {
      const targetHeight = sh;
      const targetWidth = targetHeight * videoAspect;
      return {
        width: targetWidth,
        height: targetHeight,
        left: (sw - targetWidth) / 2,
        top: 0
      };
    } else {
      const targetWidth = sw;
      const targetHeight = targetWidth / videoAspect;
      return {
        width: targetWidth,
        height: targetHeight,
        left: 0,
        top: (sh - targetHeight) / 2
      };
    }
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

  // Bascule camera avec contraintes calibrees a 1080p max (evite le flux 4k/8k non-calibre sur ROG Phone)
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

      // Négocier une résolution standard HD/FHD (1280x720 ideal, max 1920x1080)
      const standardConstraints = {
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 }
      };

      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: { exact: targetDevice.deviceId },
            ...standardConstraints
          }
        });
      } catch (err1) {
        console.warn("Tentative 1 echouee, tentative 2 sans exact:", err1);
        try {
          newStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              deviceId: targetDevice.deviceId,
              ...standardConstraints
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
        enforceNativeFit();
        window.dispatchEvent(new Event('resize'));
      };

      setTimeout(() => {
        enforceNativeFit();
        window.dispatchEvent(new Event('resize'));
      }, 300);

      updateButtonText();
    } catch (err) {
      console.error("Erreur bascule camera finale:", err);
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'environment', width: { ideal: 1280, max: 1920 } }
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

    const checkInterval = setInterval(() => {
      const { video } = getElements();
      if (video && video.srcObject) {
        clearInterval(checkInterval);
        const track = video.srcObject.getVideoTracks()[0];
        if (track) {
          updateDeviceList(track);
        }
        video.addEventListener('loadedmetadata', enforceNativeFit);
        enforceNativeFit();
      }
    }, 250);

    setTimeout(() => clearInterval(checkInterval), 10000);

    window.addEventListener('resize', enforceNativeFit);
    window.addEventListener('orientationchange', () => setTimeout(enforceNativeFit, 300));
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
