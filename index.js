const path = require('path');
const fs = require('fs');
const express = require('express');
const cheerio = require('cheerio');
const Anthropic = require('@anthropic-ai/sdk');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
}

const PROMPT_PATH = path.join(__dirname, 'templates', 'claude-prompt.txt');
let promptTemplate = '';
try {
  promptTemplate = fs.readFileSync(PROMPT_PATH, 'utf8');
} catch (e) {
  console.error('Missing prompt template at', PROMPT_PATH);
  process.exit(1);
}

function buildClaudePrompt({ pageUrl, targetHtml, targetSelector, pageContext }) {
  return promptTemplate
    .replace('{{pageContext}}', pageContext)
    .replace('{{targetSelector}}', targetSelector)
    .replace('{{targetHtml}}', targetHtml)
    .replace('{{pageUrl}}', pageUrl);
}

/** If the model wraps JavaScript in a markdown fence, strip it for copy-paste use. */
function unwrapOptionalMarkdownFence(text) {
  let t = text.trim();
  if (!t.startsWith('```')) {
    return t;
  }
  const firstLineBreak = t.indexOf('\n');
  if (firstLineBreak === -1) {
    return text.trim();
  }
  t = t.slice(firstLineBreak + 1);
  const lastFence = t.lastIndexOf('```');
  if (lastFence !== -1) {
    t = t.slice(0, lastFence);
  }
  return t.trim();
}

function detectFrameworks(htmlLower, classes, scriptSrcs, linkHrefs) {
  const hints = [];
  const bundle = `${scriptSrcs.join(' ')} ${linkHrefs.join(' ')} ${htmlLower.slice(0, 50000)}`;

  if (
    /bootstrap(\.min)?\.(css|js)/i.test(bundle) ||
    /\b(btn-primary|container-fluid|row|col-md|navbar-nav|modal-dialog)\b/.test(classes.join(' '))
  ) {
    hints.push('Bootstrap');
  }
  if (/tailwind/i.test(bundle) || /@tailwind|tailwindcss/i.test(bundle)) {
    hints.push('Tailwind CSS');
  }
  if (/bulma/i.test(bundle) || /\bis-\w+\b/.test(classes.join(' '))) {
    hints.push('Bulma (possible)');
  }
  if (/foundation/i.test(bundle)) {
    hints.push('Foundation');
  }
  if (/materialize|mui\.com|material-ui/i.test(bundle)) {
    hints.push('Material-style framework (possible)');
  }
  return [...new Set(hints)];
}

function extractPageContextFromHtml(html, resolvedUrl) {
  const $ = cheerio.load(html);
  const classSet = new Set();
  $('[class]').each((_, el) => {
    const c = $(el).attr('class');
    if (c) {
      c.split(/\s+/).forEach((token) => {
        if (token) classSet.add(token);
      });
    }
  });
  const classes = [...classSet];
  const scriptSrcs = $('script[src]')
    .map((_, el) => $(el).attr('src'))
    .get()
    .filter(Boolean);
  const linkHrefs = $('link[rel="stylesheet"], link[rel="preload"][as="style"]')
    .map((_, el) => $(el).attr('href'))
    .get()
    .filter(Boolean);

  const htmlLower = html.toLowerCase();
  const frameworks = detectFrameworks(htmlLower, classes, scriptSrcs, linkHrefs);

  const bodyClass = $('body').attr('class') || '';
  const htmlClass = $('html').attr('class') || '';

  return JSON.stringify(
    {
      resolvedUrl,
      documentTitle: $('title').first().text().trim(),
      htmlLang: $('html').attr('lang') || null,
      htmlClass: htmlClass || null,
      bodyClass: bodyClass || null,
      frameworksDetected: frameworks,
      classNameCount: classes.length,
      classNameSample: classes.slice(0, 250),
      stylesheetHrefs: linkHrefs.slice(0, 40),
      scriptSrcsSample: scriptSrcs.slice(0, 40),
      metaViewport: $('meta[name="viewport"]').attr('content') || null,
    },
    null,
    2
  );
}

async function fetchPageHtml(pageUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(pageUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; SalesforceSitemapGenerator/1.0; +https://www.salesforce.com)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timeout);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
    }
    const contentType = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(contentType) && !contentType.includes('text/plain')) {
      throw new Error(`Unexpected content-type: ${contentType || 'unknown'}`);
    }
    const html = await res.text();
    const finalUrl = res.url || pageUrl;
    return { html, finalUrl };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out while fetching the page URL.');
    }
    throw err;
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/generate', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server is not configured with ANTHROPIC_API_KEY.',
    });
  }

  const { pageUrl, targetHtml, targetSelector } = req.body || {};

  if (typeof pageUrl !== 'string' || !pageUrl.trim()) {
    return res.status(400).json({ error: 'pageUrl is required.' });
  }
  if (typeof targetHtml !== 'string') {
    return res.status(400).json({ error: 'targetHtml is required.' });
  }
  if (typeof targetSelector !== 'string' || !targetSelector.trim()) {
    return res.status(400).json({ error: 'targetSelector is required.' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(pageUrl.trim());
  } catch {
    return res.status(400).json({ error: 'pageUrl must be a valid absolute URL (including https://).' });
  }
  if (!/^https?:$/i.test(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'pageUrl must use http or https.' });
  }

  let pageContext;
  try {
    const { html, finalUrl } = await fetchPageHtml(parsedUrl.href);
    pageContext = extractPageContextFromHtml(html, finalUrl);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to fetch or parse the customer website.';
    return res.status(502).json({
      error: `Could not load PAGE_URL for context: ${message}`,
    });
  }

  const prompt = buildClaudePrompt({
    pageUrl: parsedUrl.href,
    targetHtml,
    targetSelector: targetSelector.trim(),
    pageContext,
  });

  const anthropic = new Anthropic({ apiKey });

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16384,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlocks = (msg.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    if (!textBlocks.trim()) {
      return res.status(502).json({ error: 'The model returned an empty response. Try again.' });
    }

    return res.json({ sitemap: unwrapOptionalMarkdownFence(textBlocks) });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Claude API request failed.';
    console.error('Anthropic API error:', err);
    return res.status(502).json({
      error: `Claude API error: ${message}`,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Sitemap generator listening on port ${PORT}`);
});
