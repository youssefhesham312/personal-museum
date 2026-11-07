import * as THREE from 'three';
import './ui/ui.css';

import { initDB } from './storage/db.js';
import { initOverlay, showOverlay, hideOverlay } from './ui/overlay.js';
import { initAudio } from './ui/audio.js';
import { initHud } from './ui/hud.js';
import { createInspectOverlay } from './ui/inspectOverlay.js';
import { buildMuseum } from './scene/museum.js';
import { defaultMaxTextureSize } from './scene/textures.js';
import { PlayerController } from './controls/player.js';
import { createCollisionChecker } from './controls/collision.js';
import { createDesktopInput } from './controls/desktopInput.js';
import { createTouchInput } from './controls/touchInput.js';
import { createTourState } from './core/tourState.js';
import { normalizeMuseumConfig } from './core/museumConfig.js';
import { pickTarget } from './interaction/pick.js';
import { loadMuseumConfigFromStorage, revokeObjectUrls } from './storage/museumSource.js';
import { createSampleMuseum } from './demo/sampleMuseum.js';
import { fetchSharedMuseum } from './backend/api.js';
import { isSharePath, isValidShareId, parseSharePath } from './backend/shareLink.js';

const TARGET_CHECK_INTERVAL = 0.12; // seconds

const params = new URLSearchParams(window.location.search);
const SHARE_ROUTE = isSharePath(window.location.pathname);
const SHARE_ID = parseSharePath(window.location.pathname);
const DEMO_MODE = !SHARE_ROUTE && params.get('demo') === '1';
const IS_TOUCH = window.matchMedia?.('(pointer: coarse)').matches ?? false;

// --- Renderer ---------------------------------------------------------------

const canvas = document.getElementById('canvas');
// Touch devices get a lower pixel budget and no MSAA: the scene is already
// texture-bound on phones, and this keeps the frame rate stable.
const MAX_PIXEL_RATIO = IS_TOUCH ? 1.5 : 2;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !IS_TOUCH,
  powerPreference: 'high-performance',
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf5f0e8);
scene.fog = new THREE.Fog(0xf5f0e8, 15, 50);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.6, 0);

// --- State ------------------------------------------------------------------

const player = new PlayerController(camera);
const tour = createTourState();

let audio = null;
let hud = null;
let inspectOverlay = null;
let desktopInput = null;
let touchInput = null;

let museum = null;
let museumConfig = null;
let collisionCheck = null;
let objectUrls = [];
let lastBuildMs = 0;
let currentTarget = null;
let targetTimer = 0;
let starting = false;
let exiting = false;
let pendingConfig = null;
let lastFrameTime = 0;
let renderDirty = true;
let renderCount = 0;
let lastStartDetails = null;
let sharedConfig = null;
let shareOpening = false;

// Cancelling a load invalidates the in-flight build and lets the menu start a
// fresh one immediately; stale results are discarded and disposed.
let buildToken = 0;
let buildController = null;

// --- Boot -------------------------------------------------------------------

async function init() {
  // Recipients never need local storage. Only the creator's local preview does.
  if (!SHARE_ROUTE) {
    try {
      await initDB();
    } catch (error) {
      console.error('IndexedDB is unavailable', error);
      showFatalError(
        'This browser blocked local storage, so photos cannot be kept. Try a private window in another browser, or allow site data for this page.'
      );
      return;
    }
  }

  audio = initAudio();
  hud = initHud({
    onExit: exitTour,
    onInteract: handleInteract,
    onTogglePlay: () => audio.toggle(),
    onToggleMute: () => audio.toggleMute(),
  });
  hud.setTouchMode(IS_TOUCH);

  audio.subscribe((state) => hud.setAudioState(state));

  inspectOverlay = createInspectOverlay({ onClose: handleOverlayClosed });

  player.setEnabled(false);

  let hadPointerLock = false;

  desktopInput = createDesktopInput({
    canvas,
    player,
    onInteract: handleInteract,
    hasTarget: () => Boolean(currentTarget),
    onLockChange: (locked) => {
      if (locked) {
        hadPointerLock = true;
        return;
      }
      // Only mention it when the visitor actually had the mouse captured
      // (Esc), not when the browser simply refused the initial request.
      if (hadPointerLock && tour.isExploring()) {
        hud.setHint('Mouse released. Click the museum to look around again.');
      }
      hadPointerLock = false;
    },
  });

  touchInput = createTouchInput({
    layer: hud.layer,
    player,
    hud,
    onInteract: handleInteract,
  });

  wireLoadingActions();
  animate();

  if (SHARE_ROUTE) {
    document.getElementById('overlay').classList.add('hidden');

    if (!SHARE_ID) {
      showMuseumUnavailable('invalid');
      return;
    }

    await openSharedMuseum();
    return;
  }

  initOverlay({ onStart: (details) => startTour({ details }), audio });

  if (DEMO_MODE) {
    // Small QA facade for the `?demo=1` fixture: lets automated checks place
    // the camera and inspect engine state without exposing anything in normal
    // use. Never enabled in the production path.
    window.__museumDebug = {
      get state() {
        return tour.state;
      },
      get target() {
        return currentTarget;
      },
      get photoCount() {
        return museumConfig?.photos?.length ?? 0;
      },
      get camera() {
        return { x: camera.position.x, y: camera.position.y, z: camera.position.z };
      },
      get look() {
        return { yaw: player.look.yaw, pitch: player.look.pitch };
      },
      get buildMs() {
        return lastBuildMs;
      },
      get renderCount() {
        return renderCount;
      },
      get controlsVisible() {
        return hud?.controlsVisible ?? false;
      },
      get locked() {
        return desktopInput?.isLocked() ?? false;
      },
      start() {
        startTour();
      },
      setTouchMode(value) {
        hud?.setTouchMode(value);
      },
      get interactables() {
        return museum?.interactables?.length ?? 0;
      },
      frames() {
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const normal = new THREE.Vector3();

        return (museum?.interactables ?? []).map((object) => {
          object.getWorldPosition(position);
          object.getWorldQuaternion(quaternion);
          normal.set(0, 0, 1).applyQuaternion(quaternion);
          return {
            type: object.userData.interact?.type ?? null,
            index: object.userData.interact?.index ?? null,
            position: [position.x, position.y, position.z],
            normal: [normal.x, normal.y, normal.z],
          };
        });
      },
      setLook(yaw, pitch = 0) {
        player.setLook(yaw, pitch);
      },
      ray(maxDistance = 7) {
        if (!museum) return [];
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        raycaster.far = maxDistance;
        const hits = raycaster.intersectObjects(
          [...museum.interactables, ...museum.collisionMeshes],
          true
        );
        return hits.slice(0, 6).map((hit) => ({
          distance: Number(hit.distance.toFixed(2)),
          object: hit.object.name || hit.object.type,
          interact: hit.object.userData.interact ?? null,
          point: [
            Number(hit.point.x.toFixed(2)),
            Number(hit.point.y.toFixed(2)),
            Number(hit.point.z.toFixed(2)),
          ],
        }));
      },
      stand(x, z, yaw = 0, pitch = 0) {
        camera.position.set(x, 1.6, z);
        player.setLook(yaw, pitch);
      },
      /**
       * Advance one frame of the normal tour logic. Used when the browser pane
       * is occluded and requestAnimationFrame is throttled.
       */
      step(delta = 1 / 60) {
        if (!tour.canMove()) return false;
        player.update(delta, collisionCheck);
        updateTarget();
        return true;
      },
      /**
       * Measure real render cost: N draws with a GPU sync after each. The
       * browser pane throttles requestAnimationFrame, so this is the only
       * honest way to compare lighting setups in it.
       */
      bench(frames = 20) {
        const gl = renderer.getContext();
        const lights = { total: 0, spot: 0, point: 0, ambient: 0, hemisphere: 0 };
        let meshes = 0;

        scene.traverse((object) => {
          if (object.isLight) {
            lights.total += 1;
            if (object.isSpotLight) lights.spot += 1;
            else if (object.isPointLight) lights.point += 1;
            else if (object.isAmbientLight) lights.ambient += 1;
            else if (object.isHemisphereLight) lights.hemisphere += 1;
          } else if (object.isMesh) {
            meshes += 1;
          }
        });

        // Warm up shader compilation before timing.
        renderer.render(scene, camera);
        gl.finish();

        const started = performance.now();
        for (let i = 0; i < frames; i++) {
          renderer.render(scene, camera);
          gl.finish();
        }
        const ms = (performance.now() - started) / frames;

        return {
          msPerFrame: Number(ms.toFixed(2)),
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          meshes,
          lights,
          gpuTextures: renderer.info.memory.textures,
          geometries: renderer.info.memory.geometries,
        };
      },
      /**
       * GPU time per frame via EXT_disjoint_timer_query_webgl2, when the
       * driver reports it. Resolves to null if the extension is unavailable
       * or the driver returns zeroed timings.
       */
      async benchGPU(frames = 12) {
        const gl = renderer.getContext();
        const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        if (!ext) return null;

        renderer.render(scene, camera);
        gl.finish();

        const queries = [];
        for (let i = 0; i < frames; i++) {
          const query = gl.createQuery();
          gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
          renderer.render(scene, camera);
          gl.endQuery(ext.TIME_ELAPSED_EXT);
          queries.push(query);
        }

        const values = [];
        const seen = new Set();

        for (let attempt = 0; attempt < 200; attempt++) {
          let pending = 0;
          queries.forEach((query, index) => {
            if (seen.has(index)) return;
            if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
              pending += 1;
              return;
            }
            seen.add(index);
            const value = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
            if (value > 0) values.push(value);
          });
          if (pending === 0) break;
          await new Promise((resolve) => setTimeout(resolve, 8));
        }

        for (const query of queries) gl.deleteQuery(query);
        if (values.length === 0) return null;

        const sorted = values.slice().sort((a, b) => a - b);
        return {
          samples: values.length,
          medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)),
          meanMs: Number((values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(2)),
          maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
        };
      },
    };

    pendingConfig = createSampleMuseum(params.get('photos'));
    startTour();
  }
}

// --- Shared-museum route ----------------------------------------------------

async function openSharedMuseum() {
  if (shareOpening) return;
  if (!SHARE_ID || !isValidShareId(SHARE_ID)) {
    showMuseumUnavailable('invalid');
    return;
  }

  shareOpening = true;
  hideOverlay();
  showLoading('Opening the Museum');
  setLoading({ status: 'Finding your museum…' });

  try {
    const response = await fetchSharedMuseum(SHARE_ID);
    const museum = response?.museum;

    if (!museum || !Array.isArray(museum.photos) || museum.photos.length === 0) {
      showMuseumUnavailable('not_found');
      return;
    }

    sharedConfig = normalizeMuseumConfig(museum);
    pendingConfig = sharedConfig;
    shareOpening = false;
    await startTour();
  } catch (error) {
    hideLoading();

    if (error?.code === 'expired') {
      showMuseumUnavailable('expired');
    } else if (error?.code === 'not_found') {
      showMuseumUnavailable('not_found');
    } else if (error?.code === 'invalid') {
      showMuseumUnavailable('invalid');
    } else {
      console.warn('[museum] the shared museum could not be loaded', error?.message || error);
      showMuseumUnavailable('network');
    }
  } finally {
    shareOpening = false;
  }
}

function showMuseumUnavailable(kind) {
  sharedConfig = null;

  const copy = {
    expired: {
      title: 'This museum has closed',
      message:
        'Museums stay open for seven days after they are created. This one has reached the end of its run.',
    },
    not_found: {
      title: 'This museum could not be found',
      message:
        'The link may be mistyped, or the museum may have been removed. Ask the sender for a fresh link.',
    },
    invalid: {
      title: 'This link doesn’t look right',
      message: 'The address is missing a valid museum link. Check that you copied the whole link.',
    },
    network: {
      title: 'The museum could not be opened',
      message: 'The museum service could not be reached. Check your connection and try again.',
    },
  }[kind] || {
    title: 'The museum could not be opened',
    message: 'Something went wrong while opening this museum. Please try again.',
  };

  const actions = kind === 'network'
    ? [
        { label: 'Try again', onClick: openSharedMuseum },
        { label: 'Create your own museum', href: '/' },
      ]
    : [{ label: 'Create your own museum', href: '/' }];

  showShareMessage({ title: copy.title, message: copy.message, actions });
}

function showShareExitPanel() {
  const title = sharedConfig?.title
    ? `You have left “${sharedConfig.title}”`
    : 'You have left the museum';

  showShareMessage({
    title,
    message: 'The museum is still open. You can step back inside whenever you like.',
    actions: [
      { label: 'Step back inside', onClick: openSharedMuseum },
      { label: 'Create your own museum', href: '/' },
    ],
  });
}

function showShareMessage({ title, message, actions = [] }) {
  hideLoading();
  hud?.hide();
  tour.leave();
  player.setEnabled(false);
  desktopInput?.setEnabled(false);
  touchInput?.setEnabled(false);
  desktopInput?.releaseLock();
  disposeMuseum();

  const overlay = document.getElementById('overlay');
  overlay.innerHTML = `
    <div class="menu-panel museum-message">
      <p class="museum-message-kicker">Personal Museum</p>
      <h1></h1>
      <p class="museum-message-text"></p>
      <div class="museum-message-actions"></div>
    </div>
  `;

  overlay.querySelector('h1').textContent = title;
  overlay.querySelector('.museum-message-text').textContent = message;

  const actionsEl = overlay.querySelector('.museum-message-actions');
  for (const action of actions) {
    let element;

    if (action.href) {
      element = document.createElement('a');
      element.href = action.href;
      element.className = 'museum-message-action';
    } else {
      element = document.createElement('button');
      element.type = 'button';
      element.className = 'museum-message-action';
      element.addEventListener('click', () => {
        hideOverlay();
        action.onClick?.();
      });
    }

    element.textContent = action.label;
    actionsEl.appendChild(element);
  }

  overlay.classList.remove('hidden');
  document.title = `${title} — Personal Museum`;
}

// --- Tour lifecycle ---------------------------------------------------------

async function startTour(options = {}) {
  if (starting || tour.state !== 'idle') return;

  if (options.details) lastStartDetails = options.details;

  starting = true;
  const token = ++buildToken;
  const controller = new AbortController();
  buildController = controller;

  hideOverlay();
  showLoading(SHARE_ROUTE ? 'Opening the Museum' : 'Preparing Your Exhibition');
  setLoading({ status: SHARE_ROUTE ? 'Collecting the photographs…' : 'Collecting your photographs…' });

  // Called from a user gesture in the normal flow: allowed to start audio.
  audio?.play();

  try {
    const { config, objectUrls: urls } = await getSessionConfig();
    if (token !== buildToken) {
      revokeObjectUrls(urls);
      return;
    }
    museumConfig = config;

    const buildStart = performance.now();
    const built = await buildMuseum(config, {
      maxTextureSize: defaultMaxTextureSize(),
      anisotropy: Math.min(4, renderer.capabilities.getMaxAnisotropy()),
      signal: controller.signal,
      onProgress: ({ loaded, total }) => {
        if (token !== buildToken) return;
        setLoading({
          status:
            loaded >= total
              ? 'Hanging the last frames…'
              : `Preparing photograph ${Math.max(loaded + 1, 1)} of ${total}…`,
        });
      },
    });
    lastBuildMs = Math.round(performance.now() - buildStart);

    // The visitor may have cancelled while the last photos were decoding.
    if (token !== buildToken) {
      built.dispose();
      revokeObjectUrls(urls);
      return;
    }

    disposeMuseum();
    revokeObjectUrls(objectUrls);
    objectUrls = Array.isArray(urls) ? urls : [];

    museum = built;
    scene.add(built.group);
    scene.updateMatrixWorld(true);
    renderDirty = true;

    collisionCheck = createCollisionChecker(built.collisionMeshes);

    player.reset();
    hideLoading();
    tour.enter();

    player.setEnabled(true);
    desktopInput.setEnabled(true);
    touchInput.setEnabled(true);
    hud.show({ touch: IS_TOUCH });
    hud.setAudioState(audio.getState());

    if (SHARE_ROUTE && museumConfig?.title) {
      document.title = `${museumConfig.title} — Personal Museum`;
    }

    // Progressive enhancements: never required for a usable museum.
    requestFullscreen();
    desktopInput.requestLock();
  } catch (error) {
    // A cancelled build is not a failure: the menu is already back.
    if (error?.name === 'AbortError' || token !== buildToken) return;
    console.error('Could not build the museum', error);
    showLoadingError(error);
  } finally {
    if (buildController === controller) {
      buildController = null;
      starting = false;
    }
  }
}

async function getSessionConfig() {
  if (pendingConfig) {
    const config = pendingConfig;
    pendingConfig = null;
    return { config, objectUrls: [] };
  }
  // The demo fixture needs no storage, so restarting it stays possible.
  if (DEMO_MODE) {
    return { config: createSampleMuseum(params.get('photos')), objectUrls: [] };
  }
  return loadMuseumConfigFromStorage(lastStartDetails || {});
}

function exitTour() {
  if (exiting || tour.state === 'idle') return;
  exiting = true;

  inspectOverlay?.close();

  player.setEnabled(false);
  desktopInput?.setEnabled(false);
  touchInput?.setEnabled(false);
  desktopInput?.releaseLock();

  hud?.hide();
  tour.leave();

  disposeMuseum();

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }

  if (SHARE_ROUTE) {
    showShareExitPanel();
  } else {
    showOverlay();
  }

  exiting = false;
}

function disposeMuseum() {
  if (!museum) return;
  museum.dispose();
  scene.remove(museum.group);
  museum = null;
  collisionCheck = null;
  currentTarget = null;
  revokeObjectUrls(objectUrls);
  objectUrls = [];
  renderDirty = true;
}

// --- Interaction ------------------------------------------------------------

function handleInteract() {
  if (!tour.isExploring() || !currentTarget) return;

  const { interaction } = currentTarget;

  if (interaction.type === 'photo') {
    const photo = museumConfig?.photos?.[interaction.index];
    if (!photo) return;

    tour.inspect(interaction);
    suspendInput();
    inspectOverlay.openPhoto(photo, {
      index: interaction.index,
      total: museumConfig.photos.length,
    });
    return;
  }

  if (interaction.type === 'finale') {
    tour.inspect(interaction);
    suspendInput();
    inspectOverlay.openMessage({
      title: museumConfig?.title || '',
      recipient: museumConfig?.recipient || '',
      message: museumConfig?.finalMessage || '',
    });
  }
}

function suspendInput() {
  player.setEnabled(false);
  player.setMove(0, 0);
  desktopInput.setEnabled(false);
  touchInput.setEnabled(false);
  desktopInput.releaseLock();
  hud.setTargetAvailable(false);
  hud.hideControls();
  hud.setHint('');
}

function handleOverlayClosed() {
  if (exiting || !tour.isInspecting()) return;
  tour.dismiss();
  player.setEnabled(true);
  desktopInput.setEnabled(true);
  touchInput.setEnabled(true);
  hud.restoreHint();
}

function updateTarget() {
  if (!museum || !tour.isExploring()) return;
  camera.updateMatrixWorld();
  currentTarget = pickTarget(camera, museum.interactables, museum.collisionMeshes, 7);

  if (!currentTarget) {
    hud.setTargetAvailable(false);
    return;
  }

  const label = currentTarget.interaction.type === 'finale' ? 'Read the message' : 'View photograph';
  const action = currentTarget.interaction.type === 'finale' ? 'Read' : 'View';
  hud.setTargetAvailable(true, label, action);
}

// --- Loading / error UI -----------------------------------------------------

const loadingEl = document.getElementById('loading');

function showLoading(title = 'Preparing Your Exhibition') {
  loadingEl.classList.add('visible');
  loadingEl.classList.remove('has-error');
  loadingEl.querySelector('.loading-title').textContent = title;
  const errorEl = loadingEl.querySelector('.loading-error');
  if (errorEl) errorEl.textContent = '';
}

function hideLoading() {
  loadingEl.classList.remove('visible', 'has-error');
}

function setLoading({ status }) {
  const statusEl = loadingEl.querySelector('.loading-status');
  if (statusEl && status) statusEl.textContent = status;
}

function showLoadingError(error) {
  const message =
    error && typeof error.message === 'string' && error.message.length > 0
      ? error.message
      : 'Something went wrong while preparing the museum.';

  loadingEl.classList.add('visible', 'has-error');
  loadingEl.querySelector('.loading-title').textContent = 'The museum could not open';
  const errorEl = loadingEl.querySelector('.loading-error');
  if (errorEl) {
    errorEl.textContent = `${message} Check your connection and try again.`;
  }
  tour.leave();
  player.setEnabled(false);
  desktopInput?.setEnabled(false);
  touchInput?.setEnabled(false);
}

function wireLoadingActions() {
  loadingEl.querySelectorAll('[data-action="retry"]').forEach((button) => {
    button.addEventListener('click', retryLoading);
  });
  loadingEl.querySelectorAll('[data-action="cancel"]').forEach((button) => {
    button.addEventListener('click', cancelLoading);
  });
}

/**
 * A shared museum's photo URLs are short-lived, so a retry refetches the
 * museum instead of rebuilding from the expired URLs.
 */
function retryLoading() {
  hideLoading();

  if (SHARE_ROUTE) {
    openSharedMuseum();
  } else {
    startTour();
  }
}

/**
 * Leave a build in progress and return to the menu. The in-flight build is
 * invalidated and anything it produces later is disposed, so the visitor can
 * start again immediately.
 */
function cancelLoading() {
  buildToken += 1;
  buildController?.abort();
  buildController = null;
  starting = false;

  hideLoading();
  tour.leave();
  player.setEnabled(false);
  desktopInput?.setEnabled(false);
  touchInput?.setEnabled(false);
  hud?.hide();

  if (SHARE_ROUTE) {
    showShareExitPanel();
  } else {
    showOverlay();
  }
}

function showFatalError(message) {
  const overlay = document.getElementById('overlay');
  overlay.classList.remove('hidden');
  overlay.innerHTML = `
    <div class="menu-panel">
      <h1>Personal Museum</h1>
      <p class="subtitle">Something is blocking the museum</p>
      <p class="menu-note" style="margin-top:0">${escapeHtml(message)}</p>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

// --- Browser events ---------------------------------------------------------

function requestFullscreen() {
  if (document.fullscreenElement) return;
  const request = canvas.requestFullscreen?.();
  if (request && typeof request.catch === 'function') request.catch(() => {});
}

function handleResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderDirty = true;
  touchInput?.handleResize();
}

window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', handleResize);

// Do not render while the tab is hidden, and refresh once when it returns.
document.addEventListener('visibilitychange', () => {
  lastFrameTime = 0;
  if (!document.hidden) renderDirty = true;
});

// Leaving fullscreen (Esc) must not eject the visitor from the museum; they
// still have the on-screen exit button.
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && tour.isExploring()) {
    hud?.setHint('Fullscreen ended. The museum is still open — use Leave museum to exit.');
  }
});

// --- Render loop ------------------------------------------------------------

function animate(now = 0) {
  requestAnimationFrame(animate);

  if (document.hidden) {
    lastFrameTime = now;
    return;
  }

  const delta = lastFrameTime ? Math.min((now - lastFrameTime) / 1000, 0.1) : 0;
  lastFrameTime = now;

  if (tour.canMove()) {
    player.update(delta, collisionCheck);

    targetTimer += delta;
    if (targetTimer >= TARGET_CHECK_INTERVAL) {
      targetTimer = 0;
      updateTarget();
    }

    renderer.render(scene, camera);
    renderCount += 1;
    renderDirty = false;
    return;
  }

  // The menu, loading screen and photo dialog are static: repaint only when
  // something changed (resize, a newly built museum, returning to the menu).
  if (renderDirty) {
    renderer.render(scene, camera);
    renderCount += 1;
    renderDirty = false;
  }
}

init();
