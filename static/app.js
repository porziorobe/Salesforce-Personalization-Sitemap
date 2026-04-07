(function () {
  var pageUrlInput = document.getElementById('page-url');
  var detectBtn = document.getElementById('detect-btn');
  var detectedFields = document.getElementById('detected-fields');
  var targetSelectorInput = document.getElementById('target-selector');
  var targetHtmlInput = document.getElementById('target-html');
  var manualToggle = document.getElementById('manual-toggle');
  var generateBtn = document.getElementById('generate-btn');
  var outputArea = document.getElementById('output');
  var copyBtn = document.getElementById('copy-btn');
  var errorBanner = document.getElementById('error-banner');
  var extractingIndicator = document.getElementById('extracting-indicator');

  var feedbackPanel = document.getElementById('feedback-panel');
  var feedbackNote = document.getElementById('feedback-note');
  var regenerateBtn = document.getElementById('regenerate-btn');
  var issueCheckboxes = document.querySelectorAll('input[name="fb-issue"]');

  var extractedStyles = null;
  var stylesReady = false;

  function setBtnLoading(btn, loading) {
    btn.disabled = loading;
    btn.classList.toggle('is-loading', loading);
    btn.querySelector('.btn-loading').hidden = !loading;
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

  function updateGenerateEnabled() {
    generateBtn.disabled = !stylesReady;
  }

  function showFeedbackPanel() {
    feedbackPanel.hidden = false;
    updateRegenerateEnabled();
  }

  function hideFeedbackPanel() {
    feedbackPanel.hidden = true;
    feedbackNote.value = '';
    issueCheckboxes.forEach(function (cb) { cb.checked = false; });
    regenerateBtn.disabled = true;
  }

  function getCheckedIssues() {
    var issues = [];
    issueCheckboxes.forEach(function (cb) {
      if (cb.checked) issues.push(cb.value);
    });
    return issues;
  }

  function updateRegenerateEnabled() {
    regenerateBtn.disabled = getCheckedIssues().length === 0 && !feedbackNote.value.trim();
  }

  async function extractStyles(pageUrl, targetSelector) {
    extractingIndicator.hidden = false;
    stylesReady = false;
    updateGenerateEnabled();
    try {
      var response = await fetch('/extract-styles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageUrl: pageUrl, targetSelector: targetSelector }),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        throw new Error(data.error || 'Style extraction failed.');
      }
      extractedStyles = data.extractedStyles || null;
      stylesReady = true;
      updateGenerateEnabled();
    } finally {
      extractingIndicator.hidden = true;
    }
  }

  async function detectHero() {
    clearError();
    outputArea.value = '';
    copyBtn.disabled = true;
    hideFeedbackPanel();
    extractedStyles = null;
    stylesReady = false;
    updateGenerateEnabled();

    var pageUrl = pageUrlInput.value.trim();
    if (!pageUrl) {
      showError('Please enter a Customer Website URL.');
      return;
    }

    setBtnLoading(detectBtn, true);
    try {
      var response = await fetch('/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageUrl: pageUrl }),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        showError(data.error || 'Detection failed (' + response.status + ').');
        return;
      }

      targetSelectorInput.value = data.selector || '';
      targetHtmlInput.value = data.outerHtml || '';
      detectedFields.hidden = false;
      manualToggle.checked = false;
      setEditable(false);

      try {
        await extractStyles(pageUrl, targetSelectorInput.value.trim());
      } catch (extractErr) {
        showError(extractErr.message || 'Style extraction failed.');
      }
    } catch (err) {
      showError('Network error during hero detection. Try again.');
    } finally {
      setBtnLoading(detectBtn, false);
    }
  }

  async function generateSitemap() {
    clearError();
    outputArea.value = '';
    copyBtn.disabled = true;

    var pageUrl = pageUrlInput.value.trim();
    var targetSelector = targetSelectorInput.value.trim();
    var targetHtml = targetHtmlInput.value;

    if (!pageUrl || !targetSelector || !targetHtml.trim()) {
      showError('Detection output is incomplete. Detect hero or fill fields manually.');
      return;
    }

    setBtnLoading(generateBtn, true);
    try {
      var response = await fetch('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageUrl: pageUrl,
          targetSelector: targetSelector,
          targetHtml: targetHtml,
          extractedStyles: extractedStyles,
        }),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        showError(data.error || 'Generation failed (' + response.status + ').');
        return;
      }
      if (!data.sitemap) {
        showError('Sitemap generation returned empty output.');
        return;
      }
      outputArea.value = data.sitemap;
      copyBtn.disabled = false;
      showFeedbackPanel();
    } catch (err) {
      showError('Network error during sitemap generation. Try again.');
    } finally {
      setBtnLoading(generateBtn, false);
    }
  }

  async function regenerateWithFeedback() {
    clearError();
    var issues = getCheckedIssues();
    var note = feedbackNote.value.trim();
    if (issues.length === 0 && !note) {
      showError('Select an issue or provide feedback text.');
      return;
    }

    setBtnLoading(regenerateBtn, true);
    try {
      var response = await fetch('/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageUrl: pageUrlInput.value.trim(),
          targetSelector: targetSelectorInput.value.trim(),
          targetHtml: targetHtmlInput.value,
          extractedStyles: extractedStyles,
          previousOutput: outputArea.value,
          issues: issues,
          feedbackNote: feedbackNote.value.trim(),
        }),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        showError(data.error || 'Regeneration failed (' + response.status + ').');
        return;
      }
      if (!data.sitemap) {
        showError('Regeneration returned empty output.');
        return;
      }
      outputArea.value = data.sitemap;
      copyBtn.disabled = false;
      hideFeedbackPanel();
      showFeedbackPanel();
    } catch (err) {
      showError('Network error during regeneration. Try again.');
    } finally {
      setBtnLoading(regenerateBtn, false);
    }
  }

  detectBtn.addEventListener('click', detectHero);
  generateBtn.addEventListener('click', generateSitemap);
  regenerateBtn.addEventListener('click', regenerateWithFeedback);

  issueCheckboxes.forEach(function (cb) {
    cb.addEventListener('change', updateRegenerateEnabled);
  });
  feedbackNote.addEventListener('input', updateRegenerateEnabled);

  manualToggle.addEventListener('change', function () {
    setEditable(this.checked);
  });

  copyBtn.addEventListener('click', async function () {
    if (!outputArea.value) return;
    try {
      await navigator.clipboard.writeText(outputArea.value);
      var original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      copyBtn.disabled = true;
      setTimeout(function () {
        copyBtn.textContent = original;
        copyBtn.disabled = false;
      }, 1500);
    } catch (e) {
      showError('Could not copy to clipboard.');
    }
  });
})();
