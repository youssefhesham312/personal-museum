const TRACKS = [
  '/personal-museum-bg-songs/bg_music_1.mp3',
  '/personal-museum-bg-songs/bg_music_2.mp3',
  '/personal-museum-bg-songs/bg_music_3.mp3',
];

const MUTE_KEY = 'museum-muted';
const VOLUME = 0.4;

let audioEl = null;
let currentTrack = 0;
let srcLoaded = false;
let skipAttempts = 0;
let listeners = new Set();

const state = {
  playing: false,
  muted: false,
  loaded: false,
  blocked: false,
};

function snapshot() {
  return { ...state, track: currentTrack, trackCount: TRACKS.length };
}

function emit() {
  const value = snapshot();
  for (const listener of listeners) {
    try {
      listener(value);
    } catch {
      /* a bad listener must not break audio */
    }
  }
}

function loadTrack(index) {
  if (!audioEl) return;
  currentTrack = ((index % TRACKS.length) + TRACKS.length) % TRACKS.length;
  audioEl.src = TRACKS[currentTrack];
  srcLoaded = true;
  state.loaded = true;
}

/**
 * Background music.
 *
 * Tracks are preserved exactly as before, but nothing is fetched until the
 * visitor actually starts the tour or presses play. `preload="none"` plus a
 * lazy `src` keeps ~3 MB of MP3 out of the initial page load.
 */
export function initAudio() {
  audioEl = document.getElementById('bg-music');

  if (!audioEl) {
    return {
      play: async () => false,
      pause() {},
      toggle: async () => false,
      toggleMute() {},
      setMuted() {},
      isPlaying: () => false,
      subscribe: () => () => {},
      getState: snapshot,
    };
  }

  state.muted = localStorage.getItem(MUTE_KEY) === 'true';
  audioEl.muted = state.muted;
  audioEl.volume = VOLUME;
  audioEl.preload = 'none';
  audioEl.loop = false;

  audioEl.addEventListener('play', () => {
    state.playing = true;
    state.blocked = false;
    emit();
  });

  audioEl.addEventListener('pause', () => {
    state.playing = false;
    emit();
  });

  audioEl.addEventListener('ended', () => {
    state.playing = false;
    if (skipAttempts >= TRACKS.length) return;
    loadTrack(currentTrack + 1);
    play().catch(() => {});
  });

  audioEl.addEventListener('error', () => {
    // Skip a track that cannot be fetched rather than going silent.
    state.playing = false;
    if (skipAttempts >= TRACKS.length) {
      emit();
      return;
    }
    skipAttempts += 1;
    loadTrack(currentTrack + 1);
    emit();
  });

  async function play() {
    skipAttempts = 0;
    if (!srcLoaded) loadTrack(currentTrack);
    try {
      await audioEl.play();
      state.blocked = false;
      return true;
    } catch {
      // Autoplay policy or a decode failure: leave the UI in a paused state.
      state.playing = false;
      state.blocked = true;
      emit();
      return false;
    }
  }

  function pause() {
    audioEl.pause();
  }

  async function toggle() {
    if (state.playing) {
      pause();
      return false;
    }
    return play();
  }

  function setMuted(muted) {
    state.muted = Boolean(muted);
    audioEl.muted = state.muted;
    localStorage.setItem(MUTE_KEY, String(state.muted));
    emit();
  }

  function toggleMute() {
    setMuted(!state.muted);
  }

  emit();

  return {
    play,
    pause,
    toggle,
    setMuted,
    toggleMute,
    isPlaying: () => state.playing,
    getState: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  };
}
