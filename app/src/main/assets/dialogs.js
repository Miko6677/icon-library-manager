(() => {
  'use strict';

  let activeDialog = null;

  function confirm(message, options = {}) {
    const modal = document.getElementById('app-confirm-modal');
    const title = document.getElementById('app-confirm-title');
    const body = document.getElementById('app-confirm-message');
    const kicker = document.getElementById('app-confirm-kicker');
    const cancelButton = document.getElementById('app-confirm-cancel');
    const confirmButton = document.getElementById('app-confirm-accept');
    if (!modal || !title || !body || !cancelButton || !confirmButton || activeDialog) {
      return Promise.resolve(false);
    }

    const english = options.language === 'en';
    if (kicker) kicker.textContent = options.kicker || (english ? 'LOCAL CONFIRMATION' : '本机确认');
    title.textContent = options.title || (english ? 'Please confirm' : '请确认操作');
    body.textContent = String(message || '');
    cancelButton.textContent = options.cancelLabel || (english ? 'Cancel' : '取消');
    confirmButton.textContent = options.confirmLabel || (english ? 'Continue' : '继续');
    confirmButton.classList.toggle('button-danger', Boolean(options.danger));
    confirmButton.classList.toggle('button-primary', !options.danger);
    modal.classList.remove('hidden');
    document.documentElement.classList.add('confirm-dialog-open');

    return new Promise((resolve) => {
      const previousFocus = document.activeElement;
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        cancelButton.removeEventListener('click', onCancel);
        confirmButton.removeEventListener('click', onConfirm);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKeydown);
        modal.classList.add('hidden');
        document.documentElement.classList.remove('confirm-dialog-open');
        activeDialog = null;
        if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
        resolve(result);
      };
      const onCancel = () => finish(false);
      const onConfirm = () => finish(true);
      const onBackdrop = (event) => {
        if (event.target === modal || event.target.matches('[data-confirm-cancel]')) finish(false);
      };
      const onKeydown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        } else if (event.key === 'Enter' && !['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName)) {
          event.preventDefault();
          finish(true);
        }
      };
      activeDialog = { finish };
      cancelButton.addEventListener('click', onCancel);
      confirmButton.addEventListener('click', onConfirm);
      modal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKeydown);
      cancelButton.focus();
    });
  }

  window.CueDialogs = { confirm };
})();
