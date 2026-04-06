import os
import re
import json
import logging
from urllib.parse import urljoin, urlparse

import requests
import cssutils
from bs4 import BeautifulSoup
from flask import Flask, request, jsonify, render_template

from dotenv import load_dotenv

load_dotenv()

from auth import ConnectedAppAuth
from llm_provider import ConnectAPILLM

cssutils.log.setLevel(logging.CRITICAL)

authenticator = ConnectedAppAuth(creds_file="creds.json")
llm = ConnectAPILLM(
    authenticator=authenticator,
    provider="OpenAI",
    model="sfdc_ai__DefaultOpenAIGPT4OmniMini",
    temperature=0.5,
)

app = Flask(__name__)

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)

HERO_KEYWORDS = re.compile(r"(hero|banner|jumbotron|masthead|splash|jumbo)", re.I)

DEFAULT_STYLES = {
    "banner": {"backgroundColor": "#333333", "fontFamily": "Arial, Helvetica, sans-serif"},
    "header": {"fontSize": "32px", "fontWeight": "600", "color": "#DDDDDD"},
    "subheader": {"fontSize": "20px", "fontWeight": "400", "color": "#DDDDDD"},
    "cta": {
        "backgroundColor": "#097fb3",
        "borderRadius": "20px",
        "padding": "10px 20px",
        "color": "#DDDDDD",
    },
}

LLM_PROMPT = """You are an expert Salesforce Personalization (Interaction Studio) developer.
Your job is to generate a ready-to-use sitemap JavaScript file based on inputs
from a customer's website.

You will receive four inputs:
1. PAGE_URL - The URL of the customer's webpage
2. TARGET_HTML - The raw HTML of the element to replace with personalized content
3. TARGET_SELECTOR - The CSS selector for that element
4. EXTRACTED_STYLES - A structured object of CSS values from the customer's page

Reference Implementation:
Use the structure below as your template. Do not deviate from the overall
pattern, ordering, or API method signatures. Only change: the transformer HTML
(to match customer classes/styles), [CustomerName] values, and TARGET_SELECTOR.

//SimpleSitemap
SalesforceInteractions.setLoggingLevel(100);
SalesforceInteractions.updateConsents({{
    purpose: SalesforceInteractions.ConsentPurpose.Tracking,
    provider: "Example Consent Manager",
    status: SalesforceInteractions.ConsentStatus.OptIn
}});

document.addEventListener(
    SalesforceInteractions.CustomEvents.OnSetAnonymousId, () => {{
        SalesforceInteractions.sendEvent({{
            user: {{ attributes: {{ eventType: 'identity' }} }}
        }})
    }}
);

document.querySelector('html').style.fontSize = '14px';
SalesforceInteractions.Personalization.Config.initialize({{
    additionalTransformers: [{{
        name: "[CustomerName]_Homepage_Hero_Banner",
        transformerType: "Handlebars",
        lastModifiedDate: new Date().getTime() - (1000 * 60 * 5),
        substitutionDefinitions: {{
            BackgroundImageUrl: {{ defaultValue: '[attributes].[BackgroundImageUrl]' }},
            Header: {{ defaultValue: '[attributes].[Header]' }},
            Subheader: {{ defaultValue: '[attributes].[Subheader]' }},
            CallToActionUrl: {{ defaultValue: '[attributes].[CallToActionUrl]' }},
            CallToActionText: {{ defaultValue: '[attributes].[CallToActionText]' }}
        }},
        transformerTypeDetails: {{
            html: `
                <style>
                    .sfdcep-banner {{
                        margin: 0px auto; width: 100%; min-height: 600px;
                        display: flex; flex-flow: column wrap; justify-content: center;
                        font-family: [EXTRACTED_FONT_FAMILY];
                        background-color: [EXTRACTED_BANNER_BG];
                    }}
                    .sfdcep-banner-header {{
                        font-size: [EXTRACTED_HEADER_SIZE]; padding-bottom: 40px;
                        font-weight: [EXTRACTED_HEADER_WEIGHT];
                        color: [EXTRACTED_HEADER_COLOR]; text-align: center;
                    }}
                    .sfdcep-banner-subheader {{
                        font-size: [EXTRACTED_SUBHEADER_SIZE];
                        font-weight: [EXTRACTED_SUBHEADER_WEIGHT];
                        color: [EXTRACTED_SUBHEADER_COLOR];
                        text-align: center; padding-bottom: 40px;
                    }}
                    .sfdcep-banner-cta {{ text-align: center; }}
                    .sfdcep-banner-cta a {{
                        padding: [EXTRACTED_CTA_PADDING]; display: inline-block;
                        background-color: [EXTRACTED_CTA_BG];
                        border-radius: [EXTRACTED_CTA_RADIUS];
                        color: [EXTRACTED_CTA_COLOR];
                        text-decoration: none; font-weight: 400; font-size: 18px;
                    }}
                </style>
                <div class="sfdcep-banner [EXTRACTED_WRAPPER_CLASSES]"
                    style="background: url('{{{{subVar 'BackgroundImageUrl'}}}}') no-repeat center center;">
                    <div class="sfdcep-banner-header">{{{{subVar 'Header'}}}}</div>
                    <div class="sfdcep-banner-subheader">{{{{subVar 'Subheader'}}}}</div>
                    <div class="sfdcep-banner-cta">
                        <a href="{{{{subVar 'CallToActionUrl'}}}}">{{{{subVar 'CallToActionText'}}}}</a>
                    </div>
                </div>`
        }}
    }}]
}});

/* ===================== SITEMAP ===================== */
console.log("PSP: Hello world from Data Cloud");
SalesforceInteractions.setLoggingLevel(100);
SalesforceInteractions.updateConsents({{
    purpose: SalesforceInteractions.ConsentPurpose.Tracking,
    provider: "Example Consent Manager",
    status: SalesforceInteractions.ConsentStatus.OptIn
}});

document.addEventListener(
    SalesforceInteractions.CustomEvents.OnSetAnonymousId, () => {{
        SalesforceInteractions.sendEvent({{
            user: {{ attributes: {{ eventType: 'identity', isAnonymous: 1 }} }}
        }})
    }}
);

function getMetaTag(tagName){{
    var metaTags = document.getElementsByTagName("META");
    var metaTagContent = "";
    for (var i = 0; i < metaTags.length; i++) {{
        if(metaTags[i].name == tagName){{
            metaTagContent = metaTags[i].getAttribute('content');
        }}
    }}
    return metaTagContent;
}}

SalesforceInteractions.init().then(() => {{
    const config = {{
        global: {{ onActionEvent: (event) => {{ return event; }} }},
        pageTypes: [{{
            name: "Homepage",
            isMatch: () => window.location.pathname === '/',
            interaction: {{ name: "Homepage", eventType: "browse", pageType: "Homepage" }},
            onActionEvent: (event) => {{
                if (event.interaction.name == "Homepage") {{
                    SalesforceInteractions.Personalization
                        .fetch(["[CustomerName]_Homepage_Hero_Banner"])
                        .then(r => renderBannerHeader(r.personalizations[0].attributes))
                }}
                return event;
            }},
            contentZones: [{{ name: "Homepage | Hero", selector: "TARGET_SELECTOR" }}]
        }}],
        pageTypeDefault: {{ name: "Default" }}
    }};
    SalesforceInteractions.initSitemap(config);
}});

Customization Instructions:
- Replace [CustomerName] with the value derived from PAGE_URL
- Use EXTRACTED_STYLES values to populate all [EXTRACTED_*] placeholders
- Reuse CSS class names from TARGET_HTML on the wrapper div where appropriate
- Replace TARGET_SELECTOR with the value from the input
- Personalization.fetch campaign name and transformer name must be identical strings
- Output only valid JavaScript — no markdown, no code fences, no explanation

Inputs:
- PAGE_URL: {page_url}
- TARGET_HTML: {target_html}
- TARGET_SELECTOR: {target_selector}
- EXTRACTED_STYLES: {extracted_styles}"""


def fetch_page(url):
    resp = requests.get(url, headers={"User-Agent": BROWSER_UA, "Accept": "text/html"}, timeout=25, allow_redirects=True)
    resp.raise_for_status()
    return resp.text, resp.url


def best_selector(tag):
    if tag.get("id"):
        return f"#{tag['id']}"
    classes = [c for c in tag.get("class", []) if re.match(r"^[-_a-zA-Z0-9]+$", c)]
    if classes:
        return f"{tag.name}.{'.'.join(classes[:3])}"
    return tag.name


def detect_hero(soup):
    candidates = soup.body.find_all(["section", "div"], limit=80) if soup.body else []

    for el in candidates:
        style = el.get("style", "")
        if re.search(r"background(-image)?\s*:", style, re.I):
            return el

    for el in candidates:
        cls = " ".join(el.get("class", []))
        if HERO_KEYWORDS.search(cls):
            return el

    for el in candidates:
        if el.find(["h1", "h2"]) and el.find("a"):
            return el

    first_section = soup.find("section")
    if first_section:
        return first_section

    return None


def parse_inline_style(style_str):
    out = {}
    if not style_str:
        return out
    for decl in style_str.split(";"):
        decl = decl.strip()
        if ":" not in decl:
            continue
        prop, val = decl.split(":", 1)
        out[prop.strip().lower()] = val.strip()
    return out


def collect_hero_classes(hero):
    class_set = set()
    for c in hero.get("class", []):
        class_set.add(c)
    for child in hero.find_all(True, recursive=False):
        for c in child.get("class", []):
            class_set.add(c)
    return class_set


def selector_matches(selector_text, hero_classes):
    sel = selector_text.lower()
    for cls in hero_classes:
        if f".{cls.lower()}" in sel:
            return True
    return False


def infer_bucket(selector_text, declarations):
    s = selector_text.lower()
    if " a" in s or s.endswith("a") or ".cta" in s or ".btn" in s:
        return "cta"
    if "h1" in s or "title" in s or "header" in s:
        return "header"
    if "h2" in s or "subheader" in s or "subtitle" in s or " p" in s:
        return "subheader"
    return "banner"


def pick_style_values(base, declarations, bucket):
    if bucket == "banner":
        if "background-color" in declarations:
            base["banner"]["backgroundColor"] = declarations["background-color"]
        elif "background" in declarations:
            base["banner"]["backgroundColor"] = declarations["background"]
        if "font-family" in declarations:
            base["banner"]["fontFamily"] = declarations["font-family"]
    elif bucket == "header":
        if "color" in declarations:
            base["header"]["color"] = declarations["color"]
        if "font-size" in declarations:
            base["header"]["fontSize"] = declarations["font-size"]
        if "font-weight" in declarations:
            base["header"]["fontWeight"] = declarations["font-weight"]
    elif bucket == "subheader":
        if "color" in declarations:
            base["subheader"]["color"] = declarations["color"]
        if "font-size" in declarations:
            base["subheader"]["fontSize"] = declarations["font-size"]
        if "font-weight" in declarations:
            base["subheader"]["fontWeight"] = declarations["font-weight"]
    elif bucket == "cta":
        if "background-color" in declarations:
            base["cta"]["backgroundColor"] = declarations["background-color"]
        elif "background" in declarations:
            base["cta"]["backgroundColor"] = declarations["background"]
        if "border-radius" in declarations:
            base["cta"]["borderRadius"] = declarations["border-radius"]
        if "padding" in declarations:
            base["cta"]["padding"] = declarations["padding"]
        if "color" in declarations:
            base["cta"]["color"] = declarations["color"]


def extract_matching_rules(css_text, hero_classes):
    try:
        sheet = cssutils.parseString(css_text, validate=False)
    except Exception:
        return []
    out = []
    for rule in sheet:
        if rule.type != rule.STYLE_RULE:
            continue
        sel = rule.selectorText
        if not selector_matches(sel, hero_classes):
            continue
        declarations = {}
        for prop in rule.style:
            declarations[prop.name.lower()] = prop.value
        out.append((sel, declarations))
    return out


def derive_customer_name(page_url):
    hostname = urlparse(page_url).hostname or ""
    hostname = re.sub(r"^www\.", "", hostname, flags=re.I)
    root = hostname.split(".")[0] or "Customer"
    normalized = re.sub(r"[^a-zA-Z0-9]+", " ", root).strip()
    if not normalized:
        return "Customer"
    return "".join(w.capitalize() for w in normalized.split())


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/detect", methods=["POST"])
def detect():
    data = request.get_json(silent=True) or {}
    page_url = (data.get("pageUrl") or "").strip()
    if not page_url:
        return jsonify(error="pageUrl is required."), 400

    try:
        html, final_url = fetch_page(page_url)
    except Exception as e:
        return jsonify(error=f"Failed to fetch page: {e}"), 502

    soup = BeautifulSoup(html, "html.parser")
    hero = detect_hero(soup)

    if not hero:
        return jsonify(error="Could not detect a hero element on this page."), 404

    return jsonify(
        pageUrl=final_url,
        selector=best_selector(hero),
        outerHtml=str(hero),
    )


@app.route("/extract-styles", methods=["POST"])
def extract_styles():
    data = request.get_json(silent=True) or {}
    page_url = (data.get("pageUrl") or "").strip()
    target_selector = (data.get("targetSelector") or "").strip()

    if not page_url:
        return jsonify(error="pageUrl is required."), 400
    if not target_selector:
        return jsonify(error="targetSelector is required."), 400

    try:
        html, final_url = fetch_page(page_url)
    except Exception as e:
        return jsonify(error=f"Failed to fetch page: {e}"), 502

    soup = BeautifulSoup(html, "html.parser")

    if target_selector.startswith("#"):
        hero = soup.find(id=target_selector[1:])
    elif target_selector.startswith("."):
        parts = target_selector[1:].split(".")
        hero = soup.find(class_=lambda c: c and all(p in c.split() for p in parts))
    else:
        hero = soup.select_one(target_selector)

    if not hero:
        hero = detect_hero(soup)

    extracted = json.loads(json.dumps(DEFAULT_STYLES))

    if hero:
        hero_classes = collect_hero_classes(hero)

        inline = parse_inline_style(hero.get("style", ""))
        pick_style_values(extracted, inline, "banner")
        for child in hero.find_all(True, recursive=False):
            child_inline = parse_inline_style(child.get("style", ""))
            tag_name = child.name or ""
            bucket = infer_bucket(tag_name, child_inline)
            pick_style_values(extracted, child_inline, bucket)

        for style_tag in soup.find_all("style"):
            css_text = style_tag.string or ""
            for sel, declarations in extract_matching_rules(css_text, hero_classes):
                pick_style_values(extracted, declarations, infer_bucket(sel, declarations))

        for link in soup.find_all("link", rel="stylesheet"):
            href = link.get("href")
            if not href:
                continue
            try:
                abs_url = urljoin(final_url, href)
                resp = requests.get(abs_url, headers={"User-Agent": BROWSER_UA}, timeout=15)
                if resp.status_code == 200:
                    for sel, declarations in extract_matching_rules(resp.text, hero_classes):
                        pick_style_values(extracted, declarations, infer_bucket(sel, declarations))
            except Exception:
                continue

    return jsonify(extractedStyles=extracted)


@app.route("/generate", methods=["POST"])
def generate():
    data = request.get_json(silent=True) or {}
    page_url = (data.get("pageUrl") or "").strip()
    target_html = data.get("targetHtml") or ""
    target_selector = (data.get("targetSelector") or "").strip()
    extracted_styles = data.get("extractedStyles") or DEFAULT_STYLES

    if not page_url:
        return jsonify(error="pageUrl is required."), 400
    if not target_html.strip():
        return jsonify(error="targetHtml is required."), 400
    if not target_selector:
        return jsonify(error="targetSelector is required."), 400

    prompt = LLM_PROMPT.format(
        page_url=page_url,
        target_html=target_html,
        target_selector=target_selector,
        extracted_styles=json.dumps(extracted_styles, indent=2),
    )

    try:
        result = llm.invoke(prompt)
    except Exception as e:
        return jsonify(error=f"LLM generation failed: {e}"), 502

    text = result if isinstance(result, str) else str(result)
    text = text.strip()
    if text.startswith("```"):
        first_nl = text.index("\n") if "\n" in text else len(text)
        text = text[first_nl + 1:]
        last_fence = text.rfind("```")
        if last_fence != -1:
            text = text[:last_fence]
        text = text.strip()

    return jsonify(sitemap=text)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3000))
    app.run(host="0.0.0.0", port=port, debug=True)
