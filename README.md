# GSC SEO Analysis Agent (JavaScript + UI)

JavaScript/Node app that:

1. Lets a user connect their Google account via OAuth,
2. Pulls Search Console Search Analytics data through the API,
3. Runs SEO opportunity analysis,
4. Shows the output in a browser dashboard.

It also keeps the existing CSV CLI analyzer.

## Features

- Google Search Console API OAuth flow
- Property picker (all accessible sites from connected account)
- Date-range analysis (with trend comparison)
- KPI snapshot (clicks, impressions, CTR, avg position)
- Opportunities:
  - low-CTR query wins
  - rank-lift opportunities (positions 8-20)
- Markdown + JSON output in the UI
- CSV-based CLI mode for offline analysis

---

## 1) Google Cloud setup

1. Go to Google Cloud Console and create/select a project.
2. Enable **Google Search Console API**.
3. Configure OAuth consent screen.
4. Create OAuth client credentials (**Web application**).
5. Add redirect URI:
   - `http://localhost:3000/auth/callback`

Copy your credentials for the next step.

---

## 2) Local environment setup

Install dependencies:

```bash
npm install
```

Create env file:

```bash
cp .env.example .env
```

Set values in `.env`:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
SESSION_SECRET=replace_with_long_random_value
PORT=3000
```

---

## 3) Run the web app

```bash
npm start
```

Open:

`http://localhost:3000`

Then:

1. Click **Connect Google Account**
2. Complete OAuth consent
3. Pick a Search Console property
4. Select date range + settings
5. Click **Run Analysis**

---

## 4) CSV CLI mode (still available)

```bash
npm run cli -- --input "/path/to/gsc-export.csv" --output report.md --json-output report.json
```

Useful flags:

- `--site "sc-domain:example.com"`
- `--min-impressions 300`
- `--top-n 15`
- `--trend-window-days 28`

---

## 5) Run tests

```bash
npm test
```
