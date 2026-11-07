import { handleUpload, buildUploadSummary } from './upload.js';
import {
  getAllPhotos,
  clearAllPhotos,
  updatePhoto,
  deletePhoto,
  reorderPhotos,
} from '../storage/db.js';
import { MUSEUM_LIMITS } from '../../supabase/functions/_shared/validation.js';
import { getBackendConfig } from '../backend/config.js';
import { createShareableMuseum } from '../backend/shareFlow.js';
import { buildShareUrl } from '../backend/shareLink.js';
import { friendlyMuseumError, MuseumApiError } from '../backend/api.js';
import { validateCreatorDetails } from '../backend/creatorValidation.js';
import { getLanguage, locale, t, toggleLanguage } from '../i18n.js';

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

// Photo editor state: IndexedDB is the source of truth, the DOM is rebuilt only
// when the set/order changes so typing never loses focus.
let photoItems = [];
let photoGalleryEl = null;
let draftStatusEl = null;
let dragPhotoId = null;
let photoSaveTimers = new Map();

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
  return date.toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
}

export function initOverlay({ onStart, audio }) {
  onStartTour = onStart;
  audioApi = audio;

  try {
    getBackendConfig();
    backendReady = true;
  } catch (error) {
    backendReady = false;
    backendMessage = t('errors.sharingNotConfigured');
  }

  const overlay = document.getElementById('overlay');
  const isArabic = getLanguage() === 'ar';
  const switchLabel = isArabic ? t('language.english') : t('language.arabic');
  const switchAria = isArabic ? t('language.switchToEnglish') : t('language.switchToArabic');

  overlay.innerHTML = `
    <div class="menu-panel creator-panel">
      <div class="creator-topbar">
        <button class="lang-toggle" id="lang-toggle" type="button" aria-label="${switchAria}">${switchLabel}</button>
      </div>
      <h1>${t('app.title')}</h1>
      <p class="subtitle">${t('app.subtitle')}</p>

      <div class="creator-fields">
        <label class="creator-field" for="museum-title">
          <span>${t('creator.museumTitle')}</span>
          <input id="museum-title" type="text" dir="auto" maxlength="${MUSEUM_LIMITS.maxTitleLength}" autocomplete="off" placeholder="${t('creator.museumTitlePlaceholder')}" />
          <small class="field-error" data-error-for="title"></small>
        </label>

        <label class="creator-field" for="museum-recipient">
          <span>${t('creator.recipient')}</span>
          <input id="museum-recipient" type="text" dir="auto" maxlength="${MUSEUM_LIMITS.maxNameLength}" autocomplete="off" placeholder="${t('creator.recipientPlaceholder')}" />
          <small class="field-error" data-error-for="recipient"></small>
        </label>

        <label class="creator-field" for="museum-dedication">
          <span>${t('creator.dedication')} <em>${t('creator.optional')}</em></span>
          <textarea id="museum-dedication" rows="2" dir="auto" maxlength="${MUSEUM_LIMITS.maxDedicationLength}" placeholder="${t('creator.dedicationPlaceholder')}"></textarea>
          <small class="field-error" data-error-for="dedication"></small>
        </label>

        <label class="creator-field" for="museum-final-message">
          <span>${t('creator.finalMessage')}</span>
          <textarea id="museum-final-message" rows="3" dir="auto" maxlength="${MUSEUM_LIMITS.maxFinalMessageLength}" placeholder="${t('creator.finalMessagePlaceholder')}"></textarea>
          <small class="field-error" data-error-for="finalMessage"></small>
        </label>
      </div>

      <button id="upload-btn" type="button">${t('creator.addPhotos')}</button>
      <input type="file" id="file-input" accept="image/jpeg,image/png,image/webp" multiple />
      <p class="photo-count" id="photo-count"></p>

      <div class="photo-gallery-wrap" id="photo-gallery-wrap" hidden>
        <div class="photo-gallery-head">
          <span>${t('creator.photographs')}</span>
          <span>${t('creator.reorderHint')}</span>
        </div>
        <div class="photo-gallery" id="photo-gallery"></div>
      </div>

      <p class="upload-status" id="upload-status" role="status" aria-live="polite"></p>
      <p class="draft-status" id="draft-status" hidden>${t('creator.draftSaved')}</p>

      <button id="start-btn" type="button" disabled>${t('creator.previewTour')}</button>
      <button id="share-btn" type="button" class="share-btn" disabled>${t('creator.createShareLink')}</button>
      <p class="share-hint" id="share-hint" role="status" aria-live="polite"></p>

      <div class="share-progress" id="share-progress" hidden>
        <div class="share-progress-head">
          <span id="share-progress-text">${t('share.progress.preparing')}</span>
          <button type="button" class="share-cancel" id="share-cancel">${t('share.cancel')}</button>
        </div>
        <div class="share-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="share-progress-track">
          <div class="share-progress-fill" id="share-progress-fill"></div>
        </div>
      </div>

      <div class="share-result" id="share-result" hidden>
        <p class="share-result-title">${t('share.title')}</p>
        <div class="share-url-row">
          <input id="share-url" type="text" dir="ltr" readonly aria-label="${t('share.urlLabel')}" />
          <button type="button" id="copy-share">${t('share.copy')}</button>
        </div>
        <div class="share-result-actions">
          <a id="open-share" href="#" target="_blank" rel="noopener">${t('share.open')}</a>
          <span class="copy-status" id="copy-status" role="status" aria-live="polite"></span>
        </div>
        <p class="share-expiry" id="share-expiry"></p>
        <p class="menu-note">${t('share.note')}</p>
      </div>

      <button class="mute-btn" id="reset-btn" type="button" style="display:none">${t('creator.resetPhotos')}</button>

      <div class="audio-row">
        <button class="mute-btn" id="play-btn" type="button">${t('creator.playMusic')}</button>
        <button class="mute-btn" id="mute-btn" type="button">${t('creator.musicOn')}</button>
      </div>

      <p class="menu-note">${t('creator.shareNote')}</p>
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
  const langToggle = document.getElementById('lang-toggle');
  photoGalleryEl = document.getElementById('photo-gallery');
  draftStatusEl = document.getElementById('draft-status');

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
    let text = t('share.progress.preparing');

    if (progress.phase === 'preparing') {
      percent = total > 0 ? Math.round((Number(progress.index) / total) * 25) : 5;
      text = t('share.progress.photo', { index: Number(progress.index) + 1, total });
    } else if (progress.phase === 'creating') {
      percent = 28;
      text = t('share.progress.creating');
    } else if (progress.phase === 'uploading') {
      const totalBytes = Number(progress.totalBytes) || 0;
      const loadedBytes = Number(progress.loadedBytes) || 0;
      const ratio = totalBytes > 0 ? loadedBytes / totalBytes : (total > 0 ? completed / total : 0);
      percent = Math.min(92, 30 + Math.round(ratio * 60));
      text = completed >= total && total > 0
        ? t('share.progress.finishing')
        : t('share.progress.uploading', { index: Math.min(completed + 1, total), total });
    } else if (progress.phase === 'finalizing') {
      percent = 94;
      text = t('share.progress.verifying');
    } else if (progress.phase === 'done') {
      percent = 100;
      text = t('share.progress.ready');
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
    shareNotice = t('creator.shareStale');
  }

  function refreshValidation() {
    const details = readDetails();
    const validation = validateCreatorDetails(details, photoCount);

    setFieldErrors(validation.fields);

    const missingCount = Math.max(0, MUSEUM_LIMITS.minPhotos - photoCount);
    let hint = '';

    if (!backendReady) {
      hint = t('creator.shareNotConfigured', { message: backendMessage });
    } else if (sharing) {
      hint = t('creator.creatingShare');
    } else if (photoCount > MAX_PHOTOS) {
      hint = t('creator.tooManyToShare', { max: MAX_PHOTOS });
    } else if (missingCount > 0) {
      hint = missingCount === 1
        ? t('creator.addOneMore', { count: missingCount })
        : t('creator.addMore', { count: missingCount });
    } else if (!validation.ok) {
      hint = t('creator.addDetails');
    } else if (shareNotice) {
      hint = shareNotice;
    } else {
      hint = t('creator.readyToShare');
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
      countEl.textContent = t('creator.addingPhotos');
    } else if (photoCount === 0) {
      countEl.textContent = t('creator.noPhotos');
    } else {
      countEl.textContent = t('creator.photoCount', { count: photoCount, max: MAX_PHOTOS });
    }

    resetBtn.style.display = photoCount > 0 ? 'inline-block' : 'none';
    updateDraftStatus();
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
      ? t('share.expiry', { date: formatExpiry(expiresAt) })
      : t('share.closes');
    copyStatus.textContent = '';
    shareResultEl.hidden = false;
    shareProgress.hidden = true;
  }

  function updateDraftStatus() {
    if (!draftStatusEl) return;
    const hasDetails = detailInputs.some((input) => input.value.trim().length > 0);
    draftStatusEl.hidden = photoItems.length === 0 && !hasDetails;
  }

  function clearDropClasses() {
    photoGalleryEl?.querySelectorAll('.photo-card').forEach((card) => {
      card.classList.remove('is-drop-before', 'is-drop-after');
    });
  }

  function renderPhotoEditor() {
    if (!photoGalleryEl) return;

    photoGalleryEl.innerHTML = '';

    const wrap = document.getElementById('photo-gallery-wrap');
    if (wrap) wrap.hidden = photoItems.length === 0;
    if (photoItems.length === 0) return;

    photoItems.forEach((photo, photoPosition) => {
      const humanPosition = photoPosition + 1;
      const card = document.createElement('div');
      card.className = 'photo-card';
      card.dataset.photoId = String(photo.id);

      const captionId = `photo-caption-${photo.id}`;
      card.innerHTML = `
        <button class="photo-drag" type="button" data-drag-handle aria-label="${t('creator.dragPhoto', { position: humanPosition })}" title="${t('creator.reorderHint')}">⋮⋮</button>
        <div class="photo-fields">
          <p class="photo-name" dir="auto"></p>
          <label class="photo-field" for="${captionId}">
            <span>${t('creator.caption')} <em>${t('creator.optional')}</em></span>
            <input id="${captionId}" type="text" dir="auto" data-photo-caption maxlength="${MUSEUM_LIMITS.maxCaptionLength}" placeholder="${t('creator.captionPlaceholder')}" />
          </label>
        </div>
        <div class="photo-actions">
          <button type="button" data-move-up aria-label="${t('creator.moveEarlier', { position: humanPosition })}" title="${t('creator.moveEarlierShort')}">↑</button>
          <button type="button" data-move-down aria-label="${t('creator.moveLater', { position: humanPosition })}" title="${t('creator.moveLaterShort')}">↓</button>
          <button type="button" data-remove aria-label="${t('creator.removePhoto', { position: humanPosition })}" title="${t('creator.removePhotoShort')}">×</button>
        </div>
      `;

      card.querySelector('.photo-name').textContent = photo.name || t('inspect.photograph');
      card.querySelector('[data-photo-caption]').value = photo.caption || '';
      // Only the handle is draggable, so selecting caption text never starts a
      // drag and the inputs stay ordinary controls.
      card.querySelector('[data-drag-handle]').draggable = true;
      photoGalleryEl.appendChild(card);
    });
  }

  async function loadPhotoEditor() {
    try {
      photoItems = await getAllPhotos();
    } catch (error) {
      console.error('[photos] the draft could not be loaded', error);
      photoItems = [];
    }
    photoCount = photoItems.length;
    renderPhotoEditor();
    updatePhotoCount();
  }

  function queuePhotoSave(id) {
    const pending = photoSaveTimers.get(id);
    if (pending) clearTimeout(pending);

    const timer = setTimeout(() => {
      photoSaveTimers.delete(id);
      const item = photoItems.find((photo) => photo.id === id);
      if (!item) return;
      updatePhoto(id, { caption: item.caption }).catch((error) => {
        console.error('[photos] the caption could not be saved', error);
      });
    }, 250);
    photoSaveTimers.set(id, timer);
  }

  function flushPhotoSave(id) {
    const pending = photoSaveTimers.get(id);
    if (pending) {
      clearTimeout(pending);
      photoSaveTimers.delete(id);
    }
    const item = photoItems.find((photo) => photo.id === id);
    if (!item) return;
    updatePhoto(id, { caption: item.caption }).catch((error) => {
      console.error('[photos] the caption could not be saved', error);
    });
  }

  async function persistPhotoOrder() {
    photoItems.forEach((photo, index) => {
      photo.position = index;
    });
    try {
      await reorderPhotos(photoItems.map((photo) => photo.id));
    } catch (error) {
      console.error('[photos] the new order could not be saved', error);
    }
    markShareStale();
    updatePhotoCount();
  }

  function movePhoto(draggedId, targetId, after) {
    const from = photoItems.findIndex((photo) => photo.id === draggedId);
    if (from < 0 || draggedId === targetId) return;

    const [moving] = photoItems.splice(from, 1);
    let insertAt = photoItems.findIndex((photo) => photo.id === targetId);
    if (insertAt < 0) insertAt = photoItems.length;
    if (after) insertAt += 1;
    photoItems.splice(insertAt, 0, moving);

    persistPhotoOrder();
    renderPhotoEditor();
  }

  function movePhotoBy(id, delta) {
    const from = photoItems.findIndex((photo) => photo.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= photoItems.length) return;

    [photoItems[from], photoItems[to]] = [photoItems[to], photoItems[from]];
    persistPhotoOrder();
    renderPhotoEditor();
  }

  async function removePhotoItem(id) {
    const pending = photoSaveTimers.get(id);
    if (pending) {
      clearTimeout(pending);
      photoSaveTimers.delete(id);
    }

    try {
      await deletePhoto(id);
    } catch (error) {
      console.error('[photos] the photo could not be removed', error);
      setUploadStatus(t('creator.removeFailed'), 'error');
      return;
    }

    photoItems = photoItems.filter((photo) => photo.id !== id);
    photoCount = photoItems.length;
    renderPhotoEditor();
    updatePhotoCount();
    markShareStale();
    setUploadStatus(t('creator.photoRemoved'), 'ok');
  }

  photoGalleryEl?.addEventListener('input', (event) => {
    const input = event.target;
    const card = input.closest?.('.photo-card');
    if (!card) return;

    const id = Number(card.dataset.photoId);
    const item = photoItems.find((photo) => photo.id === id);
    if (!item) return;

    if (!input.matches('[data-photo-caption]')) return;
    item.caption = input.value;

    markShareStale();
    updateDraftStatus();
    queuePhotoSave(id);
  });

  photoGalleryEl?.addEventListener('change', (event) => {
    const card = event.target.closest?.('.photo-card');
    if (!card) return;
    flushPhotoSave(Number(card.dataset.photoId));
  });

  photoGalleryEl?.addEventListener('click', (event) => {
    const card = event.target.closest?.('.photo-card');
    if (!card) return;
    const id = Number(card.dataset.photoId);

    if (event.target.closest('[data-remove]')) {
      event.preventDefault();
      removePhotoItem(id);
    } else if (event.target.closest('[data-move-up]')) {
      event.preventDefault();
      movePhotoBy(id, -1);
    } else if (event.target.closest('[data-move-down]')) {
      event.preventDefault();
      movePhotoBy(id, 1);
    }
  });

  photoGalleryEl?.addEventListener('dragstart', (event) => {
    const handle = event.target.closest?.('[data-drag-handle]');
    const card = handle?.closest('.photo-card');
    if (!card) {
      event.preventDefault();
      return;
    }

    dragPhotoId = Number(card.dataset.photoId);
    card.classList.add('is-dragging');
    event.dataTransfer?.setData('text/plain', String(dragPhotoId));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });

  photoGalleryEl?.addEventListener('dragover', (event) => {
    const card = event.target.closest?.('.photo-card');
    if (!card || dragPhotoId === null) return;
    if (Number(card.dataset.photoId) === dragPhotoId) return;

    event.preventDefault();
    clearDropClasses();
    const rect = card.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    card.classList.add(after ? 'is-drop-after' : 'is-drop-before');
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  });

  photoGalleryEl?.addEventListener('drop', (event) => {
    if (dragPhotoId === null) return;
    const card = event.target.closest?.('.photo-card');
    if (!card) return;

    event.preventDefault();
    const after = card.classList.contains('is-drop-after');
    movePhoto(dragPhotoId, Number(card.dataset.photoId), after);
    dragPhotoId = null;
    clearDropClasses();
  });

  photoGalleryEl?.addEventListener('dragend', () => {
    dragPhotoId = null;
    clearDropClasses();
    photoGalleryEl?.querySelectorAll('.photo-card').forEach((card) => {
      card.classList.remove('is-dragging');
    });
  });

  langToggle?.addEventListener('click', () => {
    toggleLanguage({ reload: true });
  });

  uploadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    if (photoCount >= MAX_PHOTOS) {
      setUploadStatus(t('creator.tooManyPhotos', { max: MAX_PHOTOS }), 'warn');
      event.target.value = '';
      return;
    }

    uploading = true;
    setUploadStatus(
      files.length === 1
        ? t('creator.addingCount')
        : t('creator.addingCountPlural', { count: files.length }),
      'ok'
    );
    updatePhotoCount();

    try {
      const result = await handleUpload(files, {
        existingCount: photoCount,
        maxPhotos: MAX_PHOTOS,
      });
      await loadPhotoEditor();
      const summary = buildUploadSummary(result);
      setUploadStatus(summary.text, summary.tone);
      if (result.added > 0) markShareStale();
    } catch (error) {
      console.error('[upload] the batch could not be processed', error);
      await loadPhotoEditor().catch(() => {});
      setUploadStatus(t('creator.uploadFailed'), 'error');
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
      updateDraftStatus();
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
        validation.errors[0] || t('creator.addDetails'),
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
          t('creator.shareNeedsPhotos', { min: MUSEUM_LIMITS.minPhotos, max: MAX_PHOTOS })
        );
      }

      const result = await createShareableMuseum({
        photos: storedPhotos.map((photo) => ({
          blob: photo.blob,
          caption: photo.caption || '',
          date: '',
        })),
        details: validation.value,
        signal: shareAbort.signal,
        onProgress: setShareProgress,
      });

      const url = buildShareUrl(result.publicId, window.location.origin);
      showShareResult(url, result.expiresAt);
      setUploadStatus(t('creator.museumReady'), 'ok');
    } catch (error) {
      if (error?.code === 'cancelled') {
        setUploadStatus(t('creator.shareCancelled'), 'warn');
      } else {
        const message = friendlyMuseumError(error);
        const cleanup = error?.cleanupPending ? t('creator.cleanupPending') : '';
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
    shareProgressText.textContent = t('share.progress.cancelling');
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
      copyStatus.textContent = t('share.copied');
    } catch {
      copyStatus.textContent = t('share.copyManual');
      shareUrlInput.select();
    }
  });

  resetBtn.addEventListener('click', async () => {
    if (uploading || sharing) return;
    await clearAllPhotos();
    photoItems = [];
    photoCount = 0;
    renderPhotoEditor();
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
      playBtn.textContent = state.playing ? t('creator.pauseMusic') : t('creator.playMusic');
      muteBtn.textContent = state.muted ? t('creator.musicOff') : t('creator.musicOn');
    });
  }

  refreshOverlayState = async () => {
    await loadPhotoEditor();
  };

  loadPhotoEditor();
  updateDraftStatus();
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
