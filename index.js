const path = require('path');
const fs = require('fs');
const express = require('express');
const cheerio = require('cheerio');
const fetch = require('node-fetch');
const cssParse = require('css-parse');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'sitemap-template.txt');
const SITEMAP_TEMPLATE = fs.readFileSync(TEMPLATE_PATH, 'utf8');

const HERO_KEYWORDS = /(hero|banner|jumbotham|masthead|splash|jumbo)/i;

const DEFAULT_STYLES = {
  banner: {
    backgroundColor: '#333333',
    fontFamily: 'Arial, Helvetica, sans-serif',
  },
  header: {
    fontSize: '32px',
    fontWeight: '600',
    color: '#DDDDDD',
  },
  subheader: {
    fontSize: '20px',
    fontWeight: '400',
    color: '#DDDDDD',
  },
  cta: {
    backgroundColor: '#097fb3',
    borderRadius: '20px',
    padding: '10px 20px',
    color: '#DDDDDD',
  },
};

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,text/css,*/*',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText || ''}`.trim());
    }

    return {
      text: await response.text(),
      finalUrl: response.url || url,
      contentType: response.headers.get('content-type') || '',
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timed out while fetching URL.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPageHtml(pageUrl) {
  const { text, finalUrl, contentType } = await fetchText(pageUrl);
  if (!/text\/html|application\/xhtml/i.test(contentType) && !contentType.includes('text/plain')) {
    throw new Error(`Unexpected content-type: ${contentType || 'unknown'}`);
  }
  return { html: text, finalUrl };
}

function validatePageUrl(pageUrl) {
  if (typeof pageUrl !== 'string' || !pageUrl.trim()) {
    throw new Error('pageUrl is required.');
  }
  const parsedUrl = new URL(pageUrl.trim());
  if (!/^https?:$/i.test(parsedUrl.protocol)) {
    throw new Error('pageUrl must use http or https.');
  }
  return parsedUrl;
}

function sanitizeClassNames(classNames) {
  return classNames
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name) => /^[-_a-zA-Z0-9:]+$/.test(name));
}

function toAbsoluteSelector(element) {
  const parts = [];
  let current = element;

  while (current && current.tagName && current.tagName !== 'html') {
    const parent = current.parent;
    let index = 1;
    if (parent && Array.isArray(parent.children)) {
      const siblings = parent.children.filter((child) => child.type === 'tag' && child.tagName === current.tagName);
      index = Math.max(1, siblings.indexOf(current) + 1);
    }
    parts.unshift(`${current.tagName}:nth-of-type(${index})`);
    current = parent;
  }

  return parts.length ? `body > ${parts.join(' > ')}` : 'section';
}

function bestSelectorForElement($, element) {
  const id = $(element).attr('id');
  if (id && /^[-_a-zA-Z0-9]+$/.test(id)) {
    return `#${id}`;
  }

  const classes = sanitizeClassNames(($(element).attr('class') || '').split(/\s+/)).slice(0, 3);
  if (classes.length > 0) {
    return `${element.tagName}.${classes.join('.')}`;
  }

  return toAbsoluteSelector(element);
}

function detectHeroElement($) {
  const topCandidates = $('body').find('section, div').slice(0, 80).get();

  const priorityOne = topCandidates.find((el) => /background(-image)?\s*:/i.test($(el).attr('style') || ''));
  if (priorityOne) return priorityOne;

  const priorityTwo = topCandidates.find((el) => HERO_KEYWORDS.test($(el).attr('class') || ''));
  if (priorityTwo) return priorityTwo;

  const priorityThree = topCandidates.find((el) => $(el).find('h1, h2').length > 0 && $(el).find('a').length > 0);
  if (priorityThree) return priorityThree;

  const firstSection = $('section').first().get(0);
  if (firstSection) return firstSection;

  return null;
}

function parseStyleAttribute(styleAttr) {
  const out = {};
  if (!styleAttr) return out;

  styleAttr
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .forEach((declaration) => {
      const idx = declaration.indexOf(':');
      if (idx === -1) return;
      const property = declaration.slice(0, idx).trim().toLowerCase();
      const value = declaration.slice(idx + 1).trim();
      if (property && value) {
        out[property] = value;
      }
    });

  return out;
}

function mergeDefined(target, source) {
  if (!source) return;
  Object.keys(source).forEach((key) => {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      target[key] = value.trim();
    }
  });
}

function collectHeroClassSet($, heroEl) {
  const classSet = new Set();
  const collect = (el) => {
    sanitizeClassNames(($(el).attr('class') || '').split(/\s+/)).forEach((name) => classSet.add(name));
  };

  collect(heroEl);
  $(heroEl)
    .children()
    .each((_, child) => collect(child));

  return classSet;
}

function selectorMatches(selector, targetSelector, heroClassSet) {
  if (!selector) return false;
  const normalized = selector.toLowerCase();
  if (targetSelector && normalized.includes(targetSelector.toLowerCase())) {
    return true;
  }
  for (const className of heroClassSet) {
    if (normalized.includes(`.${className.toLowerCase()}`)) {
      return true;
    }
  }
  return false;
}

function inferBucket(selector, declarations) {
  const normalized = (selector || '').toLowerCase();

  if (normalized.includes(' a') || normalized.endsWith('a') || normalized.includes('.cta') || normalized.includes('.btn')) {
    return 'cta';
  }
  if (normalized.includes('h1') || normalized.includes('title') || normalized.includes('header')) {
    return 'header';
  }
  if (normalized.includes('h2') || normalized.includes('p') || normalized.includes('subheader') || normalized.includes('subtitle')) {
    return 'subheader';
  }
  if (declarations['background-color'] || declarations.background || declarations['font-family']) {
    return 'banner';
  }
  return 'banner';
}

function pickStyleValues(base, declarations, bucket) {
  if (bucket === 'banner') {
    if (declarations['background-color']) base.banner.backgroundColor = declarations['background-color'];
    if (!declarations['background-color'] && declarations.background) base.banner.backgroundColor = declarations.background;
    if (declarations['font-family']) base.banner.fontFamily = declarations['font-family'];
  }

  if (bucket === 'header') {
    if (declarations.color) base.header.color = declarations.color;
    if (declarations['font-size']) base.header.fontSize = declarations['font-size'];
    if (declarations['font-weight']) base.header.fontWeight = declarations['font-weight'];
  }

  if (bucket === 'subheader') {
    if (declarations.color) base.subheader.color = declarations.color;
    if (declarations['font-size']) base.subheader.fontSize = declarations['font-size'];
    if (declarations['font-weight']) base.subheader.fontWeight = declarations['font-weight'];
  }

  if (bucket === 'cta') {
    if (declarations['background-color']) base.cta.backgroundColor = declarations['background-color'];
    if (!declarations['background-color'] && declarations.background) base.cta.backgroundColor = declarations.background;
    if (declarations['border-radius']) base.cta.borderRadius = declarations['border-radius'];
    if (declarations.padding) base.cta.padding = declarations.padding;
    if (declarations.color) base.cta.color = declarations.color;
  }
}

function extractMatchingRulesFromCss(cssText, targetSelector, heroClassSet) {
  let ast;
  try {
    ast = cssParse(cssText);
  } catch {
    return [];
  }

  const out = [];
  const rules = ast.stylesheet && Array.isArray(ast.stylesheet.rules) ? ast.stylesheet.rules : [];

  rules.forEach((rule) => {
    if (rule.type !== 'rule' || !Array.isArray(rule.selectors) || !Array.isArray(rule.declarations)) {
      return;
    }

    const matchedSelectors = rule.selectors.filter((selector) => selectorMatches(selector, targetSelector, heroClassSet));
    if (matchedSelectors.length === 0) return;

    const declarations = {};
    rule.declarations.forEach((decl) => {
      if (decl.type === 'declaration' && decl.property && decl.value) {
        declarations[decl.property.toLowerCase()] = decl.value;
      }
    });

    matchedSelectors.forEach((selector) => {
      out.push({ selector, declarations });
    });
  });

  return out;
}

async function extractStylesForSelector(pageUrl, targetSelector) {
  const { html, finalUrl } = await fetchPageHtml(pageUrl);
  const $ = cheerio.load(html, { decodeEntities: false });
  const heroEl = $(targetSelector).first();

  if (!heroEl || heroEl.length === 0) {
    throw new Error('Could not locate targetSelector on the fetched page.');
  }

  const extracted = JSON.parse(JSON.stringify(DEFAULT_STYLES));

  const heroClassSet = collectHeroClassSet($, heroEl.get(0));

  const inlineCandidates = [];
  inlineCandidates.push({ selector: targetSelector, declarations: parseStyleAttribute(heroEl.attr('style') || '') });
  heroEl.children().each((_, child) => {
    const childSel = child.tagName || '';
    inlineCandidates.push({ selector: childSel, declarations: parseStyleAttribute($(child).attr('style') || '') });
  });

  inlineCandidates.forEach(({ selector, declarations }) => {
    const bucket = inferBucket(selector, declarations);
    pickStyleValues(extracted, declarations, bucket);
  });

  const styleBlocks = $('style')
    .map((_, styleEl) => $(styleEl).html() || '')
    .get()
    .filter(Boolean);

  styleBlocks.forEach((cssText) => {
    extractMatchingRulesFromCss(cssText, targetSelector, heroClassSet).forEach(({ selector, declarations }) => {
      pickStyleValues(extracted, declarations, inferBucket(selector, declarations));
    });
  });

  const stylesheetLinks = $('link[rel="stylesheet"]')
    .map((_, linkEl) => $(linkEl).attr('href'))
    .get()
    .filter(Boolean);

  for (const href of stylesheetLinks) {
    try {
      const absoluteUrl = new URL(href, finalUrl).toString();
      const { text: cssText } = await fetchText(absoluteUrl);
      extractMatchingRulesFromCss(cssText, targetSelector, heroClassSet).forEach(({ selector, declarations }) => {
        pickStyleValues(extracted, declarations, inferBucket(selector, declarations));
      });
    } catch {
      // Ignore stylesheet fetch/parse errors and continue with remaining sources.
    }
  }

  return extracted;
}

function deriveCustomerName(pageUrl) {
  const hostname = new URL(pageUrl).hostname.replace(/^www\./i, '');
  const root = hostname.split('.')[0] || 'Customer';
  const normalized = root.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  if (!normalized) return 'Customer';
  return normalized
    .split(/\s+/)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase())
    .join('');
}

function collectRootClassesFromHtml(targetHtml) {
  const loaded = cheerio.load(targetHtml, { decodeEntities: false });
  const root = loaded.root().children().first();
  if (!root || root.length === 0) return [];
  return sanitizeClassNames((root.attr('class') || '').split(/\s+/));
}

function normalizeExtractedStyles(input) {
  const normalized = JSON.parse(JSON.stringify(DEFAULT_STYLES));
  if (!input || typeof input !== 'object') return normalized;

  mergeDefined(normalized.banner, input.banner);
  mergeDefined(normalized.header, input.header);
  mergeDefined(normalized.subheader, input.subheader);
  mergeDefined(normalized.cta, input.cta);

  return normalized;
}

function generateSitemap(customerName, targetSelector, wrapperClasses, extractedStyles) {
  return SITEMAP_TEMPLATE
    .replaceAll('[CustomerName]', customerName)
    .replaceAll('[EXTRACTED_FONT_FAMILY]', extractedStyles.banner.fontFamily)
    .replaceAll('[EXTRACTED_BANNER_BG]', extractedStyles.banner.backgroundColor)
    .replaceAll('[EXTRACTED_HEADER_SIZE]', extractedStyles.header.fontSize)
    .replaceAll('[EXTRACTED_HEADER_WEIGHT]', extractedStyles.header.fontWeight)
    .replaceAll('[EXTRACTED_HEADER_COLOR]', extractedStyles.header.color)
    .replaceAll('[EXTRACTED_SUBHEADER_SIZE]', extractedStyles.subheader.fontSize)
    .replaceAll('[EXTRACTED_SUBHEADER_WEIGHT]', extractedStyles.subheader.fontWeight)
    .replaceAll('[EXTRACTED_SUBHEADER_COLOR]', extractedStyles.subheader.color)
    .replaceAll('[EXTRACTED_CTA_PADDING]', extractedStyles.cta.padding)
    .replaceAll('[EXTRACTED_CTA_BG]', extractedStyles.cta.backgroundColor)
    .replaceAll('[EXTRACTED_CTA_RADIUS]', extractedStyles.cta.borderRadius)
    .replaceAll('[EXTRACTED_CTA_COLOR]', extractedStyles.cta.color)
    .replaceAll('[EXTRACTED_WRAPPER_CLASSES]', wrapperClasses)
    .replace('TARGET_SELECTOR', targetSelector)
    .replace('sfdcep-banner "', 'sfdcep-banner"');
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/detect', async (req, res) => {
  try {
    const parsedUrl = validatePageUrl(req.body?.pageUrl);
    const { html, finalUrl } = await fetchPageHtml(parsedUrl.href);
    const $ = cheerio.load(html, { decodeEntities: false });
    const hero = detectHeroElement($);

    if (!hero) {
      return res.status(404).json({ error: 'Could not detect a hero element on this page.' });
    }

    return res.json({
      pageUrl: finalUrl,
      targetSelector: bestSelectorForElement($, hero),
      targetHtml: $.html(hero),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Hero detection failed.';
    return res.status(400).json({ error: `Hero detection failed: ${message}` });
  }
});

app.post('/extract-styles', async (req, res) => {
  try {
    const parsedUrl = validatePageUrl(req.body?.pageUrl);
    const targetSelector = req.body?.targetSelector;

    if (typeof targetSelector !== 'string' || !targetSelector.trim()) {
      return res.status(400).json({ error: 'targetSelector is required.' });
    }

    const extractedStyles = await extractStylesForSelector(parsedUrl.href, targetSelector.trim());
    return res.json({ extractedStyles });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Style extraction failed.';
    return res.status(400).json({ error: `Style extraction failed: ${message}` });
  }
});

app.post('/generate', (req, res) => {
  try {
    const parsedUrl = validatePageUrl(req.body?.pageUrl);
    const targetHtml = req.body?.targetHtml;
    const targetSelector = req.body?.targetSelector;
    const extractedStyles = normalizeExtractedStyles(req.body?.extractedStyles);

    if (typeof targetHtml !== 'string' || !targetHtml.trim()) {
      return res.status(400).json({ error: 'targetHtml is required.' });
    }
    if (typeof targetSelector !== 'string' || !targetSelector.trim()) {
      return res.status(400).json({ error: 'targetSelector is required.' });
    }

    const customerName = deriveCustomerName(parsedUrl.href);
    const rootClasses = collectRootClassesFromHtml(targetHtml);
    const wrapperClasses = rootClasses.length ? ` ${rootClasses.join(' ')}` : '';

    const sitemap = generateSitemap(customerName, targetSelector.trim(), wrapperClasses, extractedStyles);
    return res.json({ sitemap });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sitemap generation failed.';
    return res.status(400).json({ error: `Sitemap generation failed: ${message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Sitemap generator listening on port ${PORT}`);
});
