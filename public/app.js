(function () {
  const pageUrlInput = document.getElementById('page-url');
  const detectBtn = document.getElementById('detect-btn');
  const detectedFields = document.getElementById('detected-fields');
  const targetSelectorInput = document.getElementById('target-selector');
  const targetHtmlInput = document.getElementById('target-html');
  const manualToggle = document.getElementById('manual-toggle');
  const generateBtn = document.getElementById('generate-btn');
  const outputArea = document.getElementById('output');
  const copyBtn = document.getElementById('copy-btn');
  const errorBanner = document.getElementById('error-banner');
  const extractingIndicator = document.getElementById('extracting-indicator');

  let extractedStyles = null;

  function setDetectLoading(loading) {
    detectBtn.disabled = loading;
    detectBtn.classList.toggle('is-loading', loading);
    detectBtn.querySelector('.btn-loading').hidden = !loading;
  }

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.hidden = false;
  }

  function clearError() {
    errorBanner.textContent = '';
    errorBanner.hidden = true;
  }

  function setEditable(editable) {
    targetSelectorInput.readOnly = !editable;
    targetHtmlInput.readOnly = !editable;
  }

  async function extractStyles(pageUrl, targetSelector) {
    extractingIndicator.hidden = false;
    try {
      const response = await fetch('/extract-styles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageUrl, targetSelector }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = typeof data.error === 'string' ? data.error : `Style extraction failed (${response.status}).`;
        throw new Error(msg);
      }

      extractedStyles = data.extractedStyles || null;
    } finally {
      extractingIndicator.hidden = true;
    }
  }

  async function detectHero() {
    clearError();
    outputArea.value = '';
    copyBtn.disabled = true;
    extractedStyles = null;

    const pageUrl = pageUrlInput.value.trim();
    if (!pageUrl) {
      showError('Please enter Customer Website URL.');
      return;
    }

    setDetectLoading(true);
    try {
      const response = await fetch('/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageUrl }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = typeof data.error === 'string' ? data.error : `Detection failed (${response.status}).`;
        showError(msg);
        return;
      }

      targetSelectorInput.value = data.targetSelector || '';
      targetHtmlInput.value = data.targetHtml || '';
      detectedFields.hidden = false;
      manualToggle.checked = false;
      setEditable(false);

      try {
        await extractStyles(pageUrl, targetSelectorInput.value.trim());
      } catch (extractErr) {
        const msg = extractErr instanceof Error ? extractErr.message : 'Style extraction failed.';
        showError(msg);
      }
    } catch {
      showError('Network error during hero detection. Try again.');
    } finally {
      setDetectLoading(false);
    }
  }

  async function generateSitemap() {
    clearError();
    outputArea.value = '';
    copyBtn.disabled = true;

    const pageUrl = pageUrlInput.value.trim();
    const targetSelector = targetSelectorInput.value.trim();
    const targetHtml = targetHtmlInput.value;

    if (!pageUrl || !targetSelector || !targetHtml.trim()) {
      showError('Detection output is incomplete. Detect hero or manually fill both fields.');
      return;
    }

    generateBtn.disabled = true;
    try {
      const response = await fetch('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageUrl,
          targetSelector,
          targetHtml,
          extractedStyles,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = typeof data.error === 'string' ? data.error : `Generation failed (${response.status}).`;
        showError(msg);
        return;
      }

      if (!data.sitemap || typeof data.sitemap !== 'string') {
        showError('Sitemap generation returned empty output.');
        return;
      }

      outputArea.value = data.sitemap;
      copyBtn.disabled = false;
    } catch {
      showError('Network error during sitemap generation. Try again.');
    } finally {
      generateBtn.disabled = false;
    }
  }

  detectBtn.addEventListener('click', detectHero);
  generateBtn.addEventListener('click', generateSitemap);

  manualToggle.addEventListener('change', function () {
    setEditable(this.checked);
  });

  copyBtn.addEventListener('click', async function () {
    if (!outputArea.value) return;
    try {
      await navigator.clipboard.writeText(outputArea.value);
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      copyBtn.disabled = true;
      setTimeout(function () {
        copyBtn.textContent = original;
        copyBtn.disabled = false;
      }, 1500);
    } catch {
      showError('Could not copy to clipboard.');
    }
  });
})();
