# Personalization Sitemap Generator

Node/Express app that fetches a customer page, extracts layout hints with Cheerio, and calls the Claude API to produce a Salesforce Personalization (Interaction Studio) sitemap JavaScript snippet.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | **Yes** | API key for the Anthropic Claude API. Never commit this value. |
| `PORT` | On Heroku | HTTP port. Heroku sets this automatically; locally it defaults to `3000` if unset. |
| `NODE_ENV` | Optional | Set to `production` on Heroku for typical production behavior. |

Copy `.env.example` to `.env` for local development and add your real key:

```bash
cp .env.example .env
```

## Local development

```bash
cd sitemap-generator
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy to Heroku from GitHub

1. Push this repository to GitHub (or ensure the `sitemap-generator` folder is in a repo you connect to Heroku).
2. In the [Heroku Dashboard](https://dashboard.heroku.com/), create a new app and choose **Deploy** → **GitHub** → select the repository.
3. If the Node app lives in a subfolder of the repo, set **Settings** → **Buildpacks** and use a [subdirectory buildpack](https://elements.heroku.com/buildpacks/timanovsky/subdir-heroku-buildpack) with config var `PROJECT_PATH=sitemap-generator`, **or** deploy only the `sitemap-generator` directory as its own repository.
4. **Settings** → **Config Vars**: add `ANTHROPIC_API_KEY` (and optionally `NODE_ENV` = `production`).
5. Enable **Automatic Deploys** from your chosen branch if desired.

The `Procfile` runs `web: node index.js`, and `package.json` defines `"start": "node index.js"` for Heroku’s Node buildpack.

## API

- **POST** `/generate`  
  JSON body: `{ "pageUrl": "https://...", "targetHtml": "...", "targetSelector": "..." }`  
  Response: `{ "sitemap": "..." }` or `{ "error": "..." }` with an appropriate HTTP status.

The server fetches `pageUrl`, parses HTML with Cheerio, builds a `PAGE_CONTEXT` payload (classes, linked CSS/JS, framework hints), and sends the fixed prompt template in `templates/claude-prompt.txt` to Claude.
