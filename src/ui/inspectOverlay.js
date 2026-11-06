/**
 * Photo inspection and final-message overlays.
 *
 * One dialog shell, two content modes:
 *   - openPhoto  : full image + caption + optional date
 *   - openMessage: the closing letter
 *
 * The overlay is DOM (readable at any size), while the museum itself stays 3D.
 */
export function createInspectOverlay({ onClose } = {}) {
  const root = document.createElement('div');
  root.className = 'inspect-overlay';
  root.hidden = true;
  root.innerHTML = `
    <div class="inspect-backdrop" data-close></div>
    <div class="inspect-panel" role="dialog" aria-modal="true" aria-labelledby="inspect-title">
      <button class="inspect-close" type="button" data-close aria-label="Close">✕</button>
      <div class="inspect-media" data-media hidden>
        <img data-image alt="" />
      </div>
      <div class="inspect-body">
        <p class="inspect-kicker" data-kicker></p>
        <h2 class="inspect-title" id="inspect-title" data-title></h2>
        <p class="inspect-text" data-text></p>
        <p class="inspect-meta" data-meta></p>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const panel = root.querySelector('.inspect-panel');
  const media = root.querySelector('[data-media]');
  const image = root.querySelector('[data-image]');
  const kicker = root.querySelector('[data-kicker]');
  const titleEl = root.querySelector('[data-title]');
  const textEl = root.querySelector('[data-text]');
  const metaEl = root.querySelector('[data-meta]');
  const closeButton = root.querySelector('.inspect-close');

  let isOpen = false;
  let lastFocused = null;

  function finishClose() {
    if (!isOpen) return;
    isOpen = false;
    root.hidden = true;
    root.classList.remove('is-open');
    media.hidden = true;
    image.removeAttribute('src');
    panel.classList.remove('is-letter');
    document.body.classList.remove('has-overlay');
    lastFocused?.focus?.();
    lastFocused = null;
    onClose?.();
  }

  function open() {
    lastFocused = document.activeElement;
    isOpen = true;
    root.hidden = false;
    root.classList.add('is-open');
    document.body.classList.add('has-overlay');
    closeButton.focus({ preventScroll: true });
  }

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) {
      event.preventDefault();
      finishClose();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!isOpen) return;
    if (event.code === 'Escape' || event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finishClose();
    }
  });

  return {
    /**
     * @param {{url: string, caption?: string, date?: string}} photo
     * @param {{index: number, total: number}} meta
     */
    openPhoto(photo, meta = {}) {
      panel.classList.remove('is-letter');
      media.hidden = false;
      image.alt = photo.caption ? `Photograph: ${photo.caption}` : 'Photograph';
      image.src = photo.url;

      const position = Number.isInteger(meta.index) && Number.isInteger(meta.total)
        ? `${meta.index + 1} / ${meta.total}`
        : '';
      kicker.textContent = position;
      kicker.hidden = !position;

      titleEl.textContent = photo.caption || 'A memory';
      textEl.textContent = '';
      textEl.hidden = true;

      const dateLabel = (photo.date || '').trim();
      metaEl.textContent = dateLabel;
      metaEl.hidden = !dateLabel;

      open();
    },

    /**
     * @param {{title?: string, recipient?: string, message: string}} letter
     */
    openMessage({ title = '', recipient = '', message = '' } = {}) {
      panel.classList.add('is-letter');
      media.hidden = true;
      image.removeAttribute('src');

      kicker.textContent = title;
      kicker.hidden = !title;

      titleEl.textContent = recipient ? `For ${recipient}` : 'For you';
      textEl.textContent = message;
      textEl.hidden = false;
      metaEl.hidden = true;
      metaEl.textContent = '';

      open();
    },

    close: finishClose,

    isOpen() {
      return isOpen;
    },

    el: root,
  };
}
