const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/></svg>';
const ICON_SOUND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h3l4-3.3v12.6L7 15H4z"/><path d="M15.2 8.4a5 5 0 010 7.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M17.8 5.8a8.4 8.4 0 010 12.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICON_MUTED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h3l4-3.3v12.6L7 15H4z"/><path d="M15 9.5l4 5M19 9.5l-4 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

const HINT_DURATION = 8000;
const CONTROLS_SEEN_KEY = 'museum-controls-seen';

const DESKTOP_HINT =
  'WASD to walk · drag or click to look · click or E to inspect · Esc releases the mouse';
const TOUCH_HINT = 'Left side to walk · drag to look · tap a frame or View to inspect';

const MOVEMENT_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

const CONTROLS = {
  desktop: [
    ['Walk', 'W A S D or the arrow keys'],
    ['Look', 'move the mouse — click once to capture it, or drag'],
    ['Inspect', 'click a frame or press E'],
    ['Close', 'Esc, ✕, or click outside the photo'],
    ['Leave', 'Leave museum, top right'],
  ],
  touch: [
    ['Walk', 'joystick on the left half'],
    ['Look', 'drag anywhere on the right half'],
    ['Inspect', 'tap a frame or the View button'],
    ['Close', '✕ or tap outside the photo'],
    ['Leave', 'Leave museum, top right'],
  ],
};

function readControlsSeen() {
  try {
    return window.localStorage.getItem(CONTROLS_SEEN_KEY) === '1';
  } catch {
    // Private modes can block storage; showing the card again is harmless.
    return false;
  }
}

function markControlsSeen() {
  try {
    window.localStorage.setItem(CONTROLS_SEEN_KEY, '1');
  } catch {
    /* storage is optional */
  }
}

/**
 * In-tour HUD: exit control, audio controls, reticle, target label, hint,
 * first-entry controls card, joystick and the touch interact button.
 */
export function initHud({ onExit, onInteract, onTogglePlay, onToggleMute } = {}) {
  const root = document.createElement('div');
  root.className = 'hud is-hidden';
  root.innerHTML = `
    <div class="touch-layer" data-hud-layer></div>
    <div class="hud-bar hud-bar--left">
      <button class="hud-icon" type="button" data-touch-ui data-action="play" aria-label="Pause music" aria-pressed="true">${ICON_PAUSE}</button>
      <button class="hud-icon" type="button" data-touch-ui data-action="mute" aria-label="Mute music" aria-pressed="false">${ICON_SOUND}</button>
      <button class="hud-icon hud-help" type="button" data-touch-ui data-action="help" aria-label="Show controls" aria-expanded="false">?</button>
    </div>
    <div class="hud-bar hud-bar--right">
      <button class="hud-btn hud-btn--exit" type="button" data-touch-ui data-action="exit">Leave museum</button>
    </div>
    <div class="reticle" data-reticle aria-hidden="true"></div>
    <div class="target-label" data-target-label role="status" aria-live="polite"></div>
    <div class="hud-hint" role="status" data-hint></div>
    <div class="controls-card" data-controls-card role="dialog" aria-label="How to explore" aria-hidden="true">
      <button class="controls-close" type="button" data-controls-dismiss aria-label="Close controls">×</button>
      <p class="controls-kicker">How to explore</p>
      <dl class="controls-list" data-controls-list></dl>
      <button class="controls-start" type="button" data-controls-dismiss>Begin exploring</button>
    </div>
    <div class="joystick" data-joystick aria-hidden="true">
      <div class="joystick-knob" data-joystick-knob></div>
    </div>
    <button class="interact-btn" type="button" data-touch-ui data-interact aria-label="Inspect">
      <span>View</span>
    </button>
  `;

  document.body.appendChild(root);

  const layer = root.querySelector('[data-hud-layer]');
  const exitButton = root.querySelector('[data-action="exit"]');
  const playButton = root.querySelector('[data-action="play"]');
  const muteButton = root.querySelector('[data-action="mute"]');
  const helpButton = root.querySelector('[data-action="help"]');
  const reticle = root.querySelector('[data-reticle]');
  const targetLabel = root.querySelector('[data-target-label]');
  const hint = root.querySelector('[data-hint]');
  const joystick = root.querySelector('[data-joystick]');
  const knob = root.querySelector('[data-joystick-knob]');
  const interactButton = root.querySelector('[data-interact]');
  const interactLabel = interactButton.querySelector('span');
  const controlsCard = root.querySelector('[data-controls-card]');
  const controlsList = root.querySelector('[data-controls-list]');

  let hintTimer = null;
  let touchMode = false;
  let targetAvailable = false;

  function setHint(text, { persist = false } = {}) {
    if (hintTimer) {
      clearTimeout(hintTimer);
      hintTimer = null;
    }
    hint.textContent = text || '';
    hint.classList.toggle('is-visible', Boolean(text));
    if (text && !persist) {
      hintTimer = setTimeout(() => {
        hint.classList.remove('is-visible');
        hintTimer = null;
      }, HINT_DURATION);
    }
  }

  function defaultHint() {
    return touchMode ? TOUCH_HINT : DESKTOP_HINT;
  }

  function renderControls() {
    const rows = touchMode ? CONTROLS.touch : CONTROLS.desktop;
    controlsList.innerHTML = rows
      .map(([term, value]) => `
        <div class="controls-row">
          <dt>${term}</dt>
          <dd>${value}</dd>
        </div>
      `)
      .join('');
  }

  function setControlsVisible(visible) {
    const open = Boolean(visible);
    renderControls();
    controlsCard.classList.toggle('is-visible', open);
    controlsCard.setAttribute('aria-hidden', String(!open));
    helpButton.setAttribute('aria-expanded', String(open));
    if (open) {
      // The card already explains everything; keep the bottom hint quiet.
      if (hintTimer) {
        clearTimeout(hintTimer);
        hintTimer = null;
      }
      hint.classList.remove('is-visible');
    }
  }

  function dismissControls({ showHint = true } = {}) {
    if (!controlsCard.classList.contains('is-visible')) return;
    setControlsVisible(false);
    markControlsSeen();
    if (showHint) setHint(defaultHint());
  }

  function setTargetAvailable(available, label = 'Inspect', action = 'View') {
    targetAvailable = Boolean(available);
    root.classList.toggle('has-target', targetAvailable);
    interactButton.classList.toggle('is-active', targetAvailable);
    interactButton.disabled = !targetAvailable;
    interactLabel.textContent = action;
    targetLabel.textContent = targetAvailable ? label : '';
  }

  function updateAudio({ playing, muted }) {
    playButton.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    playButton.setAttribute('aria-label', playing ? 'Pause music' : 'Play music');
    playButton.setAttribute('aria-pressed', String(Boolean(playing)));
    muteButton.innerHTML = muted ? ICON_MUTED : ICON_SOUND;
    muteButton.setAttribute('aria-label', muted ? 'Unmute music' : 'Mute music');
    muteButton.setAttribute('aria-pressed', String(Boolean(muted)));
    root.classList.toggle('is-muted', Boolean(muted));
  }

  function showJoystick(x, y) {
    dismissControls({ showHint: false });
    joystick.style.left = `${x}px`;
    joystick.style.top = `${y}px`;
    joystick.classList.add('is-active');
    knob.style.transform = 'translate(-50%, -50%)';
  }

  function moveJoystick(x, y) {
    knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  function hideJoystick() {
    joystick.classList.remove('is-active');
    knob.style.transform = 'translate(-50%, -50%)';
  }

  exitButton.addEventListener('click', (event) => {
    event.preventDefault();
    onExit?.();
  });
  playButton.addEventListener('click', (event) => {
    event.preventDefault();
    onTogglePlay?.();
  });
  muteButton.addEventListener('click', (event) => {
    event.preventDefault();
    onToggleMute?.();
  });
  helpButton.addEventListener('click', (event) => {
    event.preventDefault();
    setControlsVisible(!controlsCard.classList.contains('is-visible'));
  });
  controlsCard.querySelectorAll('[data-controls-dismiss]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      dismissControls();
    });
  });
  interactButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (targetAvailable) onInteract?.();
  });

  // Starting to move or interact is the clearest signal that the visitor has
  // read enough; the card is non-blocking, so this is a courtesy, not a gate.
  window.addEventListener('keydown', (event) => {
    if (!controlsCard.classList.contains('is-visible')) return;
    if (event.code === 'Escape' || MOVEMENT_KEYS.has(event.code)) {
      dismissControls({ showHint: false });
    }
  });
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (!controlsCard.classList.contains('is-visible')) return;
      // A touch on the scene is the start of a joystick/look gesture, not a
      // request to close the card; showJoystick closes it when walking starts.
      if (event.pointerType === 'touch') return;
      if (controlsCard.contains(event.target) || helpButton.contains(event.target)) return;
      dismissControls({ showHint: false });
    },
    true
  );

  return {
    el: root,
    layer,

    show({ touch = false } = {}) {
      touchMode = touch;
      document.body.classList.toggle('is-touch', touch);
      root.classList.remove('is-hidden');
      root.classList.toggle('is-touch', touch);
      reticle.classList.toggle('is-hidden', touch);
      targetLabel.classList.toggle('is-hidden', touch);
      setTargetAvailable(false);

      if (readControlsSeen()) {
        setControlsVisible(false);
        setHint(defaultHint());
      } else {
        setControlsVisible(true);
      }
    },

    hide() {
      root.classList.add('is-hidden');
      hideJoystick();
      setControlsVisible(false);
      setTargetAvailable(false);
      if (hintTimer) {
        clearTimeout(hintTimer);
        hintTimer = null;
      }
      hint.classList.remove('is-visible');
    },

    setTargetAvailable,
    setHint,
    restoreHint() {
      setHint(defaultHint());
    },
    setAudioState: updateAudio,

    showControls() {
      setControlsVisible(true);
    },
    hideControls() {
      setControlsVisible(false);
    },
    dismissControls,

    showJoystick,
    moveJoystick,
    hideJoystick,

    setTouchMode(value) {
      touchMode = Boolean(value);
      document.body.classList.toggle('is-touch', touchMode);
      root.classList.toggle('is-touch', touchMode);
      reticle.classList.toggle('is-hidden', touchMode);
      targetLabel.classList.toggle('is-hidden', touchMode);
      if (controlsCard.classList.contains('is-visible')) renderControls();
    },

    get isTouchMode() {
      return touchMode;
    },

    get controlsVisible() {
      return controlsCard.classList.contains('is-visible');
    },
  };
}
