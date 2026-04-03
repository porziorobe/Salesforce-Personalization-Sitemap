# Personalization Sitemap Generator

A deterministic Node/Express web app for Salesforce sales engineers. It detects likely hero content from a live customer site, extracts reusable CSS style values, and generates a Salesforce Personalization sitemap string with fixed templating.

## Stack

- Node + Express backend
- Vanilla HTML/CSS/JS frontend
- Cheerio for HTML parsing
- css-parse for stylesheet parsing
- node-fetch for page and external CSS fetches
- No LLM or external AI API

## Environment variables

Only one variable is needed for local development:

- `PORT` (optional locally, defaults to `3000`)

Use `.env.example` as a starter:

```bash
cp .env.example .env
```

## Run locally

```bash
cd sitemap-generator
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## API

- `POST /detect`
  - Request: `{ "pageUrl": "https://example.com" }`
  - Response: `{ "pageUrl": "...", "targetSelector": "...", "targetHtml": "..." }`

- `POST /extract-styles`
  - Request: `{ "pageUrl": "https://example.com", "targetSelector": ".hero" }`
  - Response: `{ "extractedStyles": { "banner": ..., "header": ..., "subheader": ..., "cta": ... } }`

- `POST /generate`
  - Request: `{ "pageUrl": "https://example.com", "targetHtml": "...", "targetSelector": "...", "extractedStyles": {...} }`
  - Response: `{ "sitemap": "..." }`

## Heroku deployment via GitHub

1. Push this app to GitHub.
2. In Heroku, create a new app.
3. Connect your GitHub repository under **Deploy**.
4. Deploy the `main` branch (or enable automatic deploys).
5. Heroku uses the included `Procfile` (`web: node index.js`) and `npm start` script.

If this app is inside a larger repository, either deploy this folder as its own repo or use a subdirectory buildpack with `PROJECT_PATH=sitemap-generator`.
