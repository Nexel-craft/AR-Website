/**
 * Gestionnaire de camera et cadrage universel pour AR.js
 * - Override natif du moteur de redimensionnement AR.js (passage de cover à contain)
 * - Maintien du flux camera sans aucun rognage avec bandes noires propres
 * - Alignement 3D pixel-par-pixel rigoureux sur le marqueur Hiro
 * - Garantit la superposition de la scène 3D devant le flux vidéo sur Android / Chrome
 */

(function () {
  let videoDevices = [];
  let currentDeviceIndex = 0;
  let isSwitching = false;

  // 1. Surcharger le calcul de redimensionnement d'AR.js pour passer en mode "contain" (sans rognage)
  if (window.THREEx && window.THREEx.ArToolkitSource) {
    window.THREEx.ArToolkitSource.prototype.onResizeElement = function () {
      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;

      let videoWidth, videoHeight;
      if (this.domElement.nodeName === "VIDEO") {
        videoWidth = this.domElement.videoWidth;
        videoHeight = this.domElement.videoHeight;
      } else if (this.domElement.nodeName === "IMG") {
        videoWidth = this.domElement.naturalWidth;
        videoHeight = this.domElement.naturalHeight;
      }

      if (!videoWidth || !videoHeight) return;

      const videoAspect = videoWidth / videoHeight;
      const screenAspect = screenWidth / screenHeight;

      let newWidth, newHeight, newMarginLeft, newMarginTop;

      if (screenAspect > videoAspect) {
        // Écran plus large que la vidéo (ex: PC) -> bandes noires sur les côtés
        newHeight = screenHeight;
        newWidth = newHeight * videoAspect;
        newMarginLeft = (screenWidth - newWidth) / 2;
        newMarginTop = 0;
      } else {
        // Écran plus haut que la vidéo (ex: Mobile portrait) -> bandes noires en haut et en bas
        newWidth = screenWidth;
        newHeight = newWidth / videoAspect;
        newMarginLeft = 0;
        newMarginTop = (screenHeight - newHeight) / 2;
      }

      const wStr = Math.round(newWidth) + "px";
      const hStr = Math.round(newHeight) + "px";
      const mlStr = Math.round(newMarginLeft) + "px";
      const mtStr = Math.round(newMarginTop) + "px";

      this.domElement.style.position = "absolute";
      this.domElement.style.top = "0px";
      this.domElement.style.left = "0px";
      this.domElement.style.width = wStr;
      this.domElement.style.height = hStr;
      this.domElement.style.marginLeft = mlStr;
      this.domElement.style.marginTop = mtStr;
      this.domElement.style.zIndex = "1";

      // Synchroniser immédiatement le canvas A-Frame Three.js
      const canvas = document.querySelector('.a-canvas');
      if (canvas) {
        canvas.style.position = "absolute";
        canvas.style.top = "0px";
        canvas.style.left = "0px";
        canvas.style.width = wStr;
        canvas.style.height = hStr;
        canvas.style.marginLeft = mlStr;
        canvas.style.marginTop = mtStr;
        canvas.style.zIndex = "2"; // Toujours devant la vidéo

        const scene = document.querySelector('a-scene');
        if (scene && scene.renderer) {
          scene.renderer.setSize(Math.round(newWidth), Math.round(newHeight), false);
        }
      }
    };

    window.THREEx.ArToolkitSource.prototype.copyElementSizeTo = function (otherElement) {
      if (!otherElement) return;
      otherElement.style.position = "absolute";
      otherElement.style.top = "0px";
      otherElement.style.left = "0px";
      otherElement.style.width = this.domElement.style.width;
      otherElement.style.height = this.domElement.style.height;
      otherElement.style.marginLeft = this.domElement.style.marginLeft;
      otherElement.style.marginTop = this.domElement.style.marginTop;
      otherElement.style.zIndex = "2";
    };
  }

  function getElements() {
    const video = document.querySelector('#arjs-video') || document.querySelector('video');
    const canvas = document.querySelector('.a-canvas') || document.querySelector('canvas');
    return { video, canvas };
  }

  // Force l'application du cadrage contain
  function applyContainFraming() {
    const { video } = getElements();
    if (video && video.videoWidth && video.videoHeight) {
      const source = window.ARjs && window.ARjs.Source ? window.ARjs.Source : null;
      const scene = document.querySelector('a-scene');
      const arSource = scene && scene.systems && scene.systems.arjs && scene.systems.arjs._arSession ? scene.systems.arjs._arSession.arSource : null;

      if (arSource && typeof arSource.onResizeElement === 'function') {
        arSource.onResizeElement();
      } else if (window.THREEx && window.THREEx.ArToolkitSource) {
        window.THREEx.ArToolkitSource.prototype.onResizeElement.call({ domElement: video });
      }
    }
  }

  // Fournit le rectangle de rendu exact pour la projection 2D
  window.getARViewport = function () {
    const { video } = getElements();
    const sw = window.innerWidth;
    const sh = window.innerHeight;

    if (!video || !video.videoWidth || !video.videoHeight) {
      return { left: 0, top: 0, width: sw, height: sh };
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const videoAspect = vw / vh;
    const screenAspect = sw / sh;

    let targetWidth, targetHeight, marginLeft, marginTop;

    if (screenAspect > videoAspect) {
      targetHeight = sh;
      targetWidth = targetHeight * videoAspect;
      marginLeft = (sw - targetWidth) / 2;
      marginTop = 0;
    } else {
      targetWidth = sw;
      targetHeight = targetWidth / videoAspect;
      marginLeft = 0;
      marginTop = (sh - targetHeight) / 2;
    }

    return {
      left: Math.round(marginLeft),
      top: Math.round(marginTop),
      width: Math.round(targetWidth),
      height: Math.round(targetHeight)
    };
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
        applyContainFraming();
        window.dispatchEvent(new Event('resize'));
      };

      setTimeout(() => {
        applyContainFraming();
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
        applyContainFraming();
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
      if (video && video.srcObject) {
        clearInterval(checkInterval);
        const track = video.srcObject.getVideoTracks()[0];
        if (track) {
          updateDeviceList(track);
        }
        video.addEventListener('loadedmetadata', applyContainFraming);
        video.addEventListener('resize', applyContainFraming);
        applyContainFraming();
      }
    }, 200);

    setTimeout(() => clearInterval(checkInterval), 10000);

    window.addEventListener('resize', () => {
      applyContainFraming();
    });
    window.addEventListener('orientationchange', () => {
      setTimeout(applyContainFraming, 250);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.cameraSwitcher = {
    switchCamera,
    applyContainFraming
  };
})();
