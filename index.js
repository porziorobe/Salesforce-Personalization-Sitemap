const path = require('path');
const fs = require('fs');
const express = require('express');
const cheerio = require('cheerio');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'sitemap-template.txt');
const SITEMAP_TEMPLATE = fs.readFileSync(TEMPLATE_PATH, 'utf8');

const DEFAULT_TRANSFORMER_HTML = `
            <style>
                .sfdcep-banner {
                    margin: 0px auto;
                    width: 100%;
                    min-height: 600px;
                    display: flex;
                    flex-flow: column wrap;
                    justify-content: center;
                    font-family: Arial, Helvetica, sans-serif;
                }
                .sfdcep-banner-header {
                    font-size: 32px;
                    padding-bottom: 40px;
                    font-weight: 600;
                    color: #DDDDDD;
                    text-align: center;
                }
                .sfdcep-banner-subheader {
                    font-size: 20px;
                    font-weight: 400;
                    color: #DDDDDD;
                    text-align: center;
                    padding-bottom: 40px;
                }
                .sfdcep-banner-cta {
                    text-align: center;
                }
                .sfdcep-banner-cta a {
                    padding: 10px 20px;
                    display: inline-block;
                    background-color: #097fb3;
                    border-radius: 20px;
                    color: #DDDDDD;
                    text-decoration: none;
                    font-weight: 400;
                    font-size: 18px;
                }
            </style>
            <div class="sfdcep-banner" style="background: url('{{subVar 'BackgroundImageUrl'}}') no-repeat center center;">
                <div class="sfdcep-banner-header">{{subVar 'Header'}}</div>
                <div class="sfdcep-banner-subheader">{{subVar 'Subheader'}}</div>
                <div class="sfdcep-banner-cta">
                    <a href="{{subVar 'CallToActionUrl'}}">{{subVar 'CallToActionText'}}</a>
                </div>
            </div>`;

const HERO_KEYWORDS = /(hero|banner|jumbotron|masthead|splash|jumbo)/i;

async function fetchPageHtml(pageUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(pageUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; SalesforceSitemapGenerator/1.0; +https://www.salesforce.com)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText || ''}`.trim());
    }

    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(contentType) && !contentType.includes('text/plain')) {
      throw new Error(`Unexpected content-type: ${contentType || 'unknown'}`);
    }

    return { html: await response.text(), finalUrl: response.url || pageUrl };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timed out while fetching the page URL.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

  const classes = (($(element).attr('class') || '').split(/\s+/).filter(Boolean).slice(0, 3))
    .filter((name) => /^[-_a-zA-Z0-9]+$/.test(name));

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

function sanitizeClasses(classNames) {
  return classNames
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name) => /^[-_a-zA-Z0-9:]+$/.test(name));
}

function buildTransformerHtml(targetHtml) {
  const loaded = cheerio.load(targetHtml, { decodeEntities: false });
  const root = loaded.root().children().first();

  if (!root || root.length === 0) {
    return DEFAULT_TRANSFORMER_HTML;
  }

  const classes = sanitizeClasses((root.attr('class') || '').split(/\s+/));
  const reusableClasses = classes.filter((name) => HERO_KEYWORDS.test(name));

  if (reusableClasses.length === 0) {
    return DEFAULT_TRANSFORMER_HTML;
  }

  const wrapperClasses = reusableClasses.join(' ');
  return `
            <div class="${wrapperClasses}" style="background-image: url('{{subVar 'BackgroundImageUrl'}}'); background-size: cover; background-position: center;">
                <div class="${wrapperClasses}__header">{{subVar 'Header'}}</div>
                <div class="${wrapperClasses}__subheader">{{subVar 'Subheader'}}</div>
                <div class="${wrapperClasses}__cta">
                    <a href="{{subVar 'CallToActionUrl'}}">{{subVar 'CallToActionText'}}</a>
                </div>
            </div>`;
}

function generateSitemap(customerName, transformerHtml, targetSelector) {
  return SITEMAP_TEMPLATE
    .replaceAll('[CustomerName]', customerName)
    .replace('{{TRANSFORMER_HTML}}', transformerHtml)
    .replace('TARGET_SELECTOR', targetSelector);
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

app.post('/generate', (req, res) => {
  try {
    const parsedUrl = validatePageUrl(req.body?.pageUrl);
    const targetHtml = req.body?.targetHtml;
    const targetSelector = req.body?.targetSelector;

    if (typeof targetHtml !== 'string' || !targetHtml.trim()) {
      return res.status(400).json({ error: 'targetHtml is required.' });
    }
    if (typeof targetSelector !== 'string' || !targetSelector.trim()) {
      return res.status(400).json({ error: 'targetSelector is required.' });
    }

    const customerName = deriveCustomerName(parsedUrl.href);
    const transformerHtml = buildTransformerHtml(targetHtml);
    const sitemap = generateSitemap(customerName, transformerHtml, targetSelector.trim());

    return res.json({ sitemap });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sitemap generation failed.';
    return res.status(400).json({ error: `Sitemap generation failed: ${message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Sitemap generator listening on port ${PORT}`);
});
