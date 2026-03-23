(function () {
  const form = document.getElementById('generate-form');
  const pageUrlInput = document.getElementById('page-url');
  const targetHtmlInput = document.getElementById('target-html');
  const targetSelectorInput = document.getElementById('target-selector');
  const generateBtn = document.getElementById('generate-btn');
  const outputArea = document.getElementById('output');
  const copyBtn = document.getElementById('copy-btn');
  const errorBanner = document.getElementById('error-banner');

  function setLoading(loading) {
    generateBtn.disabled = loading;
    generateBtn.classList.toggle('is-loading', loading);
    generateBtn.querySelector('.btn-loading').hidden = !loading;
  }

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.hidden = false;
  }

  function clearError() {
    errorBanner.textContent = '';
    errorBanner.hidden = true;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    outputArea.value = '';
    copyBtn.disabled = true;

    const pageUrl = pageUrlInput.value.trim();
    const targetHtml = targetHtmlInput.value;
    const targetSelector = targetSelectorInput.value.trim();

    if (!pageUrl || !targetHtml.trim() || !targetSelector) {
      showError('Please fill in Customer Website URL, Target Element HTML, and CSS Selector.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageUrl, targetHtml, targetSelector }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg =
          typeof data.error === 'string' && data.error
            ? data.error
            : `Request failed (${res.status}).`;
        showError(msg);
        return;
      }

      if (typeof data.sitemap !== 'string' || !data.sitemap.trim()) {
        showError('The server returned an empty sitemap. Try again.');
        return;
      }

      outputArea.value = data.sitemap;
      copyBtn.disabled = false;
    } catch {
      showError('Network error. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  });

  copyBtn.addEventListener('click', async () => {
    const text = outputArea.value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      copyBtn.disabled = true;
      setTimeout(() => {
        copyBtn.textContent = original;
        copyBtn.disabled = false;
      }, 2000);
    } catch {
      showError('Could not copy to clipboard. Select the text manually.');
    }
  });
})();
