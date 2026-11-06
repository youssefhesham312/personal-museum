import { handleUpload, buildUploadSummary } from './upload.js';
import { getPhotoCount, getAllPhotos, clearAllPhotos } from '../storage/db.js';
import { MUSEUM_LIMITS } from '../../supabase/functions/_shared/validation.js';
import { getBackendConfig } from '../backend/config.js';
import { createShareableMuseum } from '../backend/shareFlow.js';
import { buildShareUrl } from '../backend/shareLink.js';
import { friendlyMuseumError, MuseumApiError } from '../backend/api.js';
import { validateCreatorDetails } from '../backend/creatorValidation.js';

const DETAILS_KEY = 'museum-creator-details';
const MAX_PHOTOS = MUSEUM_LIMITS.maxPhotos;

let onStartTour = null;
let photoCount = 0;
let uploading = false;
let sharing = false;
let shareAbort = null;
let shareResult = null;
let shareNotice = '';
let backendReady = false;
let backendMessage = '';
let audioApi = null;
let unsubscribeAudio = null;
let refreshOverlayState = null;

function loadStoredDetails() {
  try {
    const raw = window.localStorage.getItem(DETAILS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveDetails(details) {
  try {
    window.localStorage.setItem(DETAILS_KEY, JSON.stringify(details));
  } catch {
    /* storage is optional */
  }
}

function formatExpiry(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function initOverlay({ onStart, audio }) {
  onStartTour = onStart;
  audioApi = audio;

  try {
    getBackendConfig();
    backendReady = true;
  } catch (error) {
    backendReady = false;
    backendMessage = error?.message || 'Sharing is not configured.';
  }

  const overlay = document.getElementById('overlay');

  overlay.innerHTML = `
    <div class="menu-panel creator-panel">
      <h1>Personal Museum</h1>
      <p class="subtitle">A gallery you can send to someone</p>

      <div class="creator-fields">
        <label class="creator-field" for="museum-title">
          <span>Museum title</span>
          <input id="museum-title" type="text" maxlength="${MUSEUM_LIMITS.maxTitleLength}" autocomplete="off" placeholder="Moments for Noor" />
          <small class="field-error" data-error-for="title"></small>
        </label>

        <label class="creator-field" for="museum-recipient">
          <span>Recipient's name</span>
          <input id="museum-recipient" type="text" maxlength="${MUSEUM_LIMITS.maxNameLength}" autocomplete="off" placeholder="Noor" />
          <small class="field-error" data-error-for="recipient"></small>
        </label>

        <label class="creator-field" for="museum-dedication">
          <span>Dedication <em>optional</em></span>
          <textarea id="museum-dedication" rows="2" maxlength="${MUSEUM_LIMITS.maxDedicationLength}" placeholder="A few words for the entrance hall"></textarea>
          <small class="field-error" data-error-for="dedication"></small>
        </label>

        <label class="creator-field" for="museum-final-message">
          <span>Closing message</span>
          <textarea id="museum-final-message" rows="3" maxlength="${MUSEUM_LIMITS.maxFinalMessageLength}" placeholder="The message waiting at the end of the museum"></textarea>
          <small class="field-error" data-error-for="finalMessage"></small>
        </label>
      </div>

      <button id="upload-btn" type="button">Add Photos</button>
      <input type="file" id="file-input" accept="image/jpeg,image/png,image/webp" multiple />
      <p class="photo-count" id="photo-count"></p>
      <p class="upload-status" id="upload-status" role="status" aria-live="polite"></p>

      <button id="start-btn" type="button" disabled>Preview the Tour</button>
      <button id="share-btn" type="button" class="share-btn" disabled>Create Share Link</button>
      <p class="share-hint" id="share-hint" role="status" aria-live="polite"></p>

      <div class="share-progress" id="share-progress" hidden>
        <div class="share-progress-head">
          <span id="share-progress-text">Preparing photographs…</span>
          <button type="button" class="share-cancel" id="share-cancel">Cancel</button>
        </div>
        <div class="share-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="share-progress-track">
          <div class="share-progress-fill" id="share-progress-fill"></div>
        </div>
      </div>

      <div class="share-result" id="share-result" hidden>
        <p class="share-result-title">Your museum is ready</p>
        <div class="share-url-row">
          <input id="share-url" type="text" readonly aria-label="Shareable museum link" />
          <button type="button" id="copy-share">Copy</button>
        </div>
        <div class="share-result-actions">
          <a id="open-share" href="#" target="_blank" rel="noopener">Open museum</a>
          <span class="copy-status" id="copy-status" role="status" aria-live="polite"></span>
        </div>
        <p class="share-expiry" id="share-expiry"></p>
        <p class="menu-note">Anyone with this link can view the museum. It cannot edit or delete anything.</p>
      </div>

      <button class="mute-btn" id="reset-btn" type="button" style="display:none">Reset Photos</button>

      <div class="audio-row">
        <button class="mute-btn" id="play-btn" type="button">▶ Play Music</button>
        <button class="mute-btn" id="mute-btn" type="button">♪ Music: On</button>
      </div>

      <p class="menu-note">Share links are view-only and close automatically seven days after creation.</p>
    </div>
  `;

  const uploadBtn = document.getElementById('upload-btn');
  const fileInput = document.getElementById('file-input');
  const startBtn = document.getElementById('start-btn');
  const shareBtn = document.getElementById('share-btn');
  const shareHint = document.getElementById('share-hint');
  const shareProgress = document.getElementById('share-progress');
  const shareProgressText = document.getElementById('share-progress-text');
  const shareProgressTrack = document.getElementById('share-progress-track');
  const shareProgressFill = document.getElementById('share-progress-fill');
  const shareCancel = document.getElementById('share-cancel');
  const shareResultEl = document.getElementById('share-result');
  const shareUrlInput = document.getElementById('share-url');
  const openShare = document.getElementById('open-share');
  const copyShare = document.getElementById('copy-share');
  const copyStatus = document.getElementById('copy-status');
  const shareExpiry = document.getElementById('share-expiry');
  const resetBtn = document.getElementById('reset-btn');
  const playBtn = document.getElementById('play-btn');
  const muteBtn = document.getElementById('mute-btn');

  const titleInput = document.getElementById('museum-title');
  const recipientInput = document.getElementById('museum-recipient');
  const dedicationInput = document.getElementById('museum-dedication');
  const finalMessageInput = document.getElementById('museum-final-message');
  const detailInputs = [titleInput, recipientInput, dedicationInput, finalMessageInput];

  const stored = loadStoredDetails();
  titleInput.value = typeof stored.title === 'string' ? stored.title : '';
  recipientInput.value = typeof stored.recipient === 'string' ? stored.recipient : '';
  dedicationInput.value = typeof stored.dedication === 'string' ? stored.dedication : '';
  finalMessageInput.value = typeof stored.finalMessage === 'string' ? stored.finalMessage : '';

  function readDetails() {
    return {
      title: titleInput.value,
      recipient: recipientInput.value,
      dedication: dedicationInput.value,
      finalMessage: finalMessageInput.value,
    };
  }

  function setShareProgress(progress) {
    const total = Number(progress.total) || 0;
    const completed = Number(progress.completed) || 0;
    let percent = 0;
    let text = 'Preparing photographs…';

    if (progress.phase === 'preparing') {
      percent = total > 0 ? Math.round((Number(progress.index) / total) * 25) : 5;
      text = `Preparing photograph ${Number(progress.index) + 1} of ${total}…`;
    } else if (progress.phase === 'creating') {
      percent = 28;
      text = 'Creating your museum…';
    } else if (progress.phase === 'uploading') {
      const totalBytes = Number(progress.totalBytes) || 0;
      const loadedBytes = Number(progress.loadedBytes) || 0;
      const ratio = totalBytes > 0 ? loadedBytes / totalBytes : (total > 0 ? completed / total : 0);
      percent = Math.min(92, 30 + Math.round(ratio * 60));
      text = completed >= total && total > 0
        ? 'Finishing uploads…'
        : `Uploading photograph ${Math.min(completed + 1, total)} of ${total}…`;
    } else if (progress.phase === 'finalizing') {
      percent = 94;
      text = 'Checking every photograph…';
    } else if (progress.phase === 'done') {
      percent = 100;
      text = 'Ready.';
    }

    shareProgressText.textContent = text;
    shareProgressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    shareProgressTrack.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, percent))));
  }

  function setFieldErrors(fields = {}) {
    for (const input of detailInputs) {
      input.removeAttribute('aria-invalid');
    }

    overlay.querySelectorAll('[data-error-for]').forEach((element) => {
      const key = element.getAttribute('data-error-for');
      element.textContent = fields?.[key] || '';
    });

    const fieldIds = {
      title: 'museum-title',
      recipient: 'museum-recipient',
      dedication: 'museum-dedication',
      finalMessage: 'museum-final-message',
    };

    for (const [key, message] of Object.entries(fields || {})) {
      const input = document.getElementById(fieldIds[key]);
      if (input && message) input.setAttribute('aria-invalid', 'true');
    }
  }

  function hideShareResult() {
    shareResult = null;
    shareResultEl.hidden = true;
    copyStatus.textContent = '';
    openShare.setAttribute('href', '#');
    shareUrlInput.value = '';
    shareExpiry.textContent = '';
  }

  function markShareStale() {
    if (!shareResult) return;
    hideShareResult();
    shareNotice = 'Details or photographs changed. Create a new link to include the changes.';
  }

  function refreshValidation() {
    const details = readDetails();
    const validation = validateCreatorDetails(details, photoCount);

    setFieldErrors(validation.fields);

    const missingCount = Math.max(0, MUSEUM_LIMITS.minPhotos - photoCount);
    let hint = '';

    if (!backendReady) {
      hint = `${backendMessage} Local preview still works.`;
    } else if (sharing) {
      hint = 'Creating your share link…';
    } else if (photoCount > MAX_PHOTOS) {
      hint = `A museum can hold at most ${MAX_PHOTOS} photographs. Remove some to share.`;
    } else if (missingCount > 0) {
      hint = `Add ${missingCount} more photograph${missingCount === 1 ? '' : 's'} to create a share link.`;
    } else if (!validation.ok) {
      hint = 'Add a title, the recipient’s name and a closing message.';
    } else if (shareNotice) {
      hint = shareNotice;
    } else {
      hint = 'Ready to create a view-only link.';
    }

    shareHint.textContent = hint;
    shareHint.classList.toggle('is-error', !backendReady || photoCount > MAX_PHOTOS);
    shareBtn.disabled = uploading || sharing || !backendReady || !validation.ok;
    startBtn.disabled = uploading || sharing || photoCount === 0;
    uploadBtn.disabled = uploading || sharing || photoCount >= MAX_PHOTOS;
    resetBtn.disabled = uploading || sharing;
    fileInput.disabled = uploading || sharing || photoCount >= MAX_PHOTOS;
  }

  function updatePhotoCount() {
    const countEl = document.getElementById('photo-count');
    if (!countEl) return;

    if (uploading) {
      countEl.textContent = 'Adding photos…';
    } else if (photoCount === 0) {
      countEl.textContent = 'No photos yet';
    } else {
      countEl.textContent = `${photoCount} of ${MAX_PHOTOS} photos added`;
    }

    resetBtn.style.display = photoCount > 0 ? 'inline-block' : 'none';
    refreshValidation();
  }

  function setUploadStatus(text, tone) {
    const el = document.getElementById('upload-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-warn', tone === 'warn');
    el.classList.toggle('is-error', tone === 'error');
  }

  function showShareResult(url, expiresAt) {
    shareResult = { url, expiresAt };
    shareNotice = '';
    shareUrlInput.value = url;
    openShare.setAttribute('href', url);
    shareExpiry.textContent = expiresAt
      ? `Open until ${formatExpiry(expiresAt)}.`
      : 'This museum closes seven days after creation.';
    copyStatus.textContent = '';
    shareResultEl.hidden = false;
    shareProgress.hidden = true;
  }

  uploadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    if (photoCount >= MAX_PHOTOS) {
      setUploadStatus(`A museum can hold at most ${MAX_PHOTOS} photos. Remove some first.`, 'warn');
      event.target.value = '';
      return;
    }

    uploading = true;
    setUploadStatus(`Adding ${files.length} photo${files.length === 1 ? '' : 's'}…`, 'ok');
    updatePhotoCount();

    try {
      const result = await handleUpload(files, {
        existingCount: photoCount,
        maxPhotos: MAX_PHOTOS,
      });
      photoCount = result.count;
      const summary = buildUploadSummary(result);
      setUploadStatus(summary.text, summary.tone);
      if (result.added > 0) markShareStale();
    } catch (error) {
      console.error('[upload] the batch could not be processed', error);
      photoCount = await getPhotoCount().catch(() => photoCount);
      setUploadStatus('The photos could not be added. Check browser storage and try again.', 'error');
    } finally {
      uploading = false;
      updatePhotoCount();
      event.target.value = '';
    }
  });

  for (const input of detailInputs) {
    input.addEventListener('input', () => {
      saveDetails(readDetails());
      markShareStale();
      refreshValidation();
    });
  }

  startBtn.addEventListener('click', () => {
    if (uploading || sharing || photoCount === 0) return;
    onStartTour?.(readDetails());
  });

  shareBtn.addEventListener('click', async () => {
    if (!backendReady || uploading || sharing) return;

    const details = readDetails();
    const validation = validateCreatorDetails(details, photoCount);
    setFieldErrors(validation.fields);

    if (!validation.ok) {
      setUploadStatus(
        validation.errors[0] || 'Add a title, the recipient’s name and a closing message.',
        'error'
      );
      refreshValidation();
      return;
    }

    sharing = true;
    shareAbort = new AbortController();
    shareNotice = '';
    hideShareResult();
    shareProgress.hidden = false;
    shareCancel.disabled = false;
    setShareProgress({ phase: 'preparing', index: 0, total: photoCount });
    setUploadStatus('', 'ok');
    refreshValidation();

    try {
      const storedPhotos = await getAllPhotos();
      if (storedPhotos.length < MUSEUM_LIMITS.minPhotos || storedPhotos.length > MAX_PHOTOS) {
        throw new MuseumApiError(
          'invalid',
          `A shareable museum needs ${MUSEUM_LIMITS.minPhotos}–${MAX_PHOTOS} photographs.`
        );
      }

      const result = await createShareableMuseum({
        photos: storedPhotos.map((photo) => ({
          blob: photo.blob,
          caption: photo.caption || '',
          date: photo.date || '',
        })),
        details: validation.value,
        signal: shareAbort.signal,
        onProgress: setShareProgress,
      });

      const url = buildShareUrl(result.publicId, window.location.origin);
      showShareResult(url, result.expiresAt);
      setUploadStatus('Your museum is ready. Copy the link and send it.', 'ok');
    } catch (error) {
      if (error?.code === 'cancelled') {
        setUploadStatus('Share link creation cancelled.', 'warn');
      } else {
        const message = friendlyMuseumError(error);
        const cleanup = error?.cleanupPending
          ? ' The unfinished upload will be removed automatically.'
          : '';
        setUploadStatus(`${message}${cleanup}`, 'error');
        if (error?.fields) setFieldErrors(error.fields);
      }
    } finally {
      sharing = false;
      shareAbort = null;
      shareProgress.hidden = true;
      shareCancel.disabled = false;
      refreshValidation();
    }
  });

  shareCancel.addEventListener('click', () => {
    if (!shareAbort) return;
    shareCancel.disabled = true;
    shareProgressText.textContent = 'Cancelling…';
    shareAbort.abort();
  });

  shareUrlInput.addEventListener('focus', () => shareUrlInput.select());

  copyShare.addEventListener('click', async () => {
    if (!shareResult) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareResult.url);
      } else {
        shareUrlInput.select();
        if (!document.execCommand('copy')) throw new Error('copy failed');
      }
      copyStatus.textContent = 'Copied.';
    } catch {
      copyStatus.textContent = 'Press Ctrl/Cmd+C to copy.';
      shareUrlInput.select();
    }
  });

  resetBtn.addEventListener('click', async () => {
    if (uploading || sharing) return;
    await clearAllPhotos();
    photoCount = 0;
    setUploadStatus('', 'ok');
    markShareStale();
    updatePhotoCount();
  });

  playBtn.addEventListener('click', () => {
    audioApi?.toggle();
  });

  muteBtn.addEventListener('click', () => {
    audioApi?.toggleMute();
  });

  if (audioApi) {
    unsubscribeAudio = audioApi.subscribe((state) => {
      playBtn.textContent = state.playing ? '❚❚ Pause Music' : '▶ Play Music';
      muteBtn.textContent = state.muted ? '♪ Music: Off' : '♪ Music: On';
    });
  }

  refreshOverlayState = async () => {
    photoCount = await getPhotoCount().catch(() => photoCount);
    updatePhotoCount();
  };

  getPhotoCount().then((count) => {
    photoCount = count;
    updatePhotoCount();
  });

  refreshValidation();
}

export function showOverlay() {
  document.getElementById('overlay').classList.remove('hidden');
  refreshOverlayState?.();
}

export function hideOverlay() {
  document.getElementById('overlay').classList.add('hidden');
}

export function disposeOverlay() {
  unsubscribeAudio?.();
  unsubscribeAudio = null;
}
