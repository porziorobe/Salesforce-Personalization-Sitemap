# Personalization Sitemap Generator

A deterministic Node/Express web app for Salesforce sales engineers. It detects a likely homepage hero element from a live customer site and generates a Salesforce Personalization sitemap string via fixed string templating.

## Stack

- Node + Express backend
- Vanilla HTML/CSS/JS frontend
- Cheerio for HTML parsing
- No LLM or external AI API

## Environment variables

Only one variable is required for local development:

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
  - Response: `{ "targetSelector": "...", "targetHtml": "...", "pageUrl": "..." }`

- `POST /generate`
  - Request: `{ "pageUrl": "https://example.com", "targetHtml": "...", "targetSelector": "..." }`
  - Response: `{ "sitemap": "..." }`

## Heroku deployment via GitHub

1. Push this app to GitHub.
2. In Heroku, create a new app.
3. Connect the GitHub repository in **Deploy**.
4. Deploy the `main` branch (or enable auto deploy).
5. Ensure the app runs with the included `Procfile` (`web: node index.js`).

If this app lives in a subdirectory of a larger repo, either deploy this folder as its own repo or use a subdirectory buildpack and set `PROJECT_PATH=sitemap-generator`.
