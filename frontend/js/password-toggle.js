// Shared by every password form, including fields added later in dialogs.
(() => {
  const eye = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const eyeOff = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3.1 3.8M6.2 6.2A20 20 0 0 0 2 12s3.5 7 10 7a13 13 0 0 0 5.8-1.4M10 10a3 3 0 0 0 4 4"/></svg>';
  function enhance(root) {
    root.querySelectorAll('input[type="password"]').forEach(input => {
      if (input.closest('.password-input-wrap')) return;
      const wrap = document.createElement('div');
      wrap.className = 'password-input-wrap';
      input.before(wrap);
      wrap.append(input);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'password-visibility-toggle';
      button.setAttribute('aria-label', 'Show password');
      button.setAttribute('aria-pressed', 'false');
      if (input.id) button.setAttribute('aria-controls', input.id);
      button.innerHTML = eye;
      button.addEventListener('click', () => {
        const visible = input.type === 'password';
        input.type = visible ? 'text' : 'password';
        button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
        button.setAttribute('aria-pressed', String(visible));
        button.innerHTML = visible ? eyeOff : eye;
      });
      wrap.append(button);
    });
  }
  function init() {
    enhance(document);
    new MutationObserver(() => enhance(document)).observe(document.body, {childList: true, subtree: true});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
