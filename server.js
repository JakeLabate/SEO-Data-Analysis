"use strict";

const dotenv = require("dotenv");
const express = require("express");
const session = require("express-session");

const { analyzeRecords, renderMarkdownReport, toJson } = require("./src/analyzer");
const {
  applyCredentials,
  exchangeCodeForTokens,
  fetchAllSearchAnalyticsRows,
  getGoogleAuthUrl,
  getOAuthClientFromEnv,
  listAccessibleSites,
  mapSearchAnalyticsRowsToRecords
} = require("./src/gscApi");

dotenv.config();

const PORT = Number(process.env.PORT || 3000);

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function defaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 27);
  return { startDate: toDateInputValue(start), endDate: toDateInputValue(end) };
}

function formatPct(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function renderTableRows(items, cols) {
  return items
    .map((item) => {
      const tds = cols
        .map((col) => `<td>${escapeHtml(typeof col === "function" ? col(item) : item[col])}</td>`)
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
}

function renderAnalysisSection(result) {
  if (!result) return "";
  const { analysis, markdown, fetchedRows, recordsCount, params } = result;

  const topQueriesRows = renderTableRows(analysis.top_queries, [
    "query",
    (row) => row.clicks.toLocaleString(),
    (row) => row.impressions.toLocaleString(),
    (row) => formatPct(row.ctr),
    (row) => Number(row.position).toFixed(2)
  ]);

  const topPagesRows = renderTableRows(analysis.top_pages, [
    "page",
    (row) => row.clicks.toLocaleString(),
    (row) => row.impressions.toLocaleString(),
    (row) => formatPct(row.ctr),
    (row) => Number(row.position).toFixed(2)
  ]);

  const lowCtrRows = analysis.opportunities.low_ctr_queries
    .map(
      (row) =>
        `<li><strong>${escapeHtml(row.query || "(not set)")}</strong>: ${row.impressions.toLocaleString()} impressions at ${formatPct(
          row.ctr
        )}, potential +${row.potential_click_gain.toLocaleString()} clicks.</li>`
    )
    .join("");

  const rankLiftRows = analysis.opportunities.rank_lift_queries
    .map(
      (row) =>
        `<li><strong>${escapeHtml(row.query || "(not set)")}</strong>: avg position ${Number(
          row.position
        ).toFixed(2)}, potential +${row.potential_click_gain.toLocaleString()} clicks.</li>`
    )
    .join("");

  const trendBlock = analysis.trend
    ? `<div class="card">
        <h3>Trend (${analysis.trend.window_days}d vs prior)</h3>
        <p>Clicks: <strong>${analysis.trend.current_clicks.toLocaleString()}</strong> (${formatPct(
          analysis.trend.clicks_change_pct
        )})</p>
        <p>Impressions: <strong>${analysis.trend.current_impressions.toLocaleString()}</strong> (${formatPct(
          analysis.trend.impressions_change_pct
        )})</p>
        <p>CTR: <strong>${formatPct(analysis.trend.current_ctr)}</strong></p>
      </div>`
    : "";

  return `
    <section class="panel">
      <h2>Analysis Output</h2>
      <p class="muted">Property: <code>${escapeHtml(params.siteUrl)}</code> | Date range: ${escapeHtml(
        params.startDate
      )} to ${escapeHtml(params.endDate)} | API rows fetched: ${fetchedRows.toLocaleString()} | Records analyzed: ${recordsCount.toLocaleString()}</p>
      <div class="kpis">
        <div class="card"><h3>Clicks</h3><p>${analysis.kpis.clicks.toLocaleString()}</p></div>
        <div class="card"><h3>Impressions</h3><p>${analysis.kpis.impressions.toLocaleString()}</p></div>
        <div class="card"><h3>CTR</h3><p>${formatPct(analysis.kpis.ctr)}</p></div>
        <div class="card"><h3>Avg Position</h3><p>${Number(analysis.kpis.avg_position).toFixed(2)}</p></div>
      </div>
      ${trendBlock}
      <div class="grid">
        <div>
          <h3>Top Queries</h3>
          <table>
            <thead><tr><th>Query</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th></tr></thead>
            <tbody>${topQueriesRows}</tbody>
          </table>
        </div>
        <div>
          <h3>Top Pages</h3>
          <table>
            <thead><tr><th>Page</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th></tr></thead>
            <tbody>${topPagesRows}</tbody>
          </table>
        </div>
      </div>
      <div class="grid">
        <div>
          <h3>Low CTR Opportunities</h3>
          <ul>${lowCtrRows || "<li>No low-CTR opportunities found.</li>"}</ul>
        </div>
        <div>
          <h3>Rank Lift Opportunities</h3>
          <ul>${rankLiftRows || "<li>No rank-lift opportunities found.</li>"}</ul>
        </div>
      </div>
      <details>
        <summary>Markdown report</summary>
        <pre>${escapeHtml(markdown)}</pre>
      </details>
      <details>
        <summary>Raw JSON analysis</summary>
        <pre>${escapeHtml(toJson(analysis))}</pre>
      </details>
    </section>
  `;
}

function renderPage({ connected, authUrl, sites, error, result }) {
  const defaults = defaultDateRange();
  const siteOptions = (sites || [])
    .map(
      (site) =>
        `<option value="${escapeHtml(site.siteUrl)}">${escapeHtml(site.siteUrl)} (${escapeHtml(
          site.permissionLevel
        )})</option>`
    )
    .join("");

  const analysisSection = renderAnalysisSection(result);

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>GSC SEO Analysis Dashboard</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
        .container { max-width: 1100px; margin: 0 auto; padding: 24px; }
        .panel { background: #111827; border: 1px solid #334155; border-radius: 10px; padding: 18px; margin-bottom: 16px; }
        h1, h2, h3 { margin-top: 0; }
        .muted { color: #94a3b8; }
        .btn { display: inline-block; background: #2563eb; color: #fff; padding: 10px 14px; border-radius: 8px; text-decoration: none; border: none; cursor: pointer; }
        .btn.secondary { background: #475569; }
        .row { display: flex; gap: 10px; flex-wrap: wrap; }
        .field { display: flex; flex-direction: column; gap: 6px; min-width: 170px; flex: 1; }
        input, select { padding: 8px; border-radius: 8px; border: 1px solid #475569; background: #0b1220; color: #e2e8f0; }
        .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin: 16px 0; }
        .card { border: 1px solid #334155; border-radius: 8px; padding: 12px; background: #0b1220; }
        .grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
        @media (min-width: 980px) { .grid { grid-template-columns: 1fr 1fr; } }
        table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
        th, td { border-bottom: 1px solid #334155; padding: 8px 6px; text-align: left; vertical-align: top; }
        code, pre { background: #0b1220; border: 1px solid #334155; border-radius: 8px; padding: 4px 6px; }
        pre { padding: 10px; white-space: pre-wrap; overflow-x: auto; }
        .error { border: 1px solid #f87171; color: #fecaca; background: #7f1d1d; border-radius: 8px; padding: 10px; margin-bottom: 12px; }
      </style>
    </head>
    <body>
      <main class="container">
        <section class="panel">
          <h1>Google Search Console SEO Analyzer</h1>
          <p class="muted">Connect your Google account, select a Search Console property, and run an API-based SEO analysis.</p>
          ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
          ${
            connected
              ? `<p>Connected to Google Search Console.</p>
                 <form method="post" action="/analyze">
                   <div class="row">
                     <label class="field">
                       <span>Property</span>
                       <select name="siteUrl" required>${siteOptions}</select>
                     </label>
                     <label class="field">
                       <span>Start date</span>
                       <input type="date" name="startDate" value="${escapeHtml(defaults.startDate)}" required />
                     </label>
                     <label class="field">
                       <span>End date</span>
                       <input type="date" name="endDate" value="${escapeHtml(defaults.endDate)}" required />
                     </label>
                   </div>
                   <div class="row">
                     <label class="field">
                       <span>Min impressions</span>
                       <input type="number" name="minImpressions" min="0" value="200" />
                     </label>
                     <label class="field">
                       <span>Top N rows</span>
                       <input type="number" name="topN" min="1" value="10" />
                     </label>
                     <label class="field">
                       <span>Trend window days</span>
                       <input type="number" name="trendWindowDays" min="1" value="28" />
                     </label>
                   </div>
                   <div class="row">
                     <button class="btn" type="submit">Run Analysis</button>
                     <a class="btn secondary" href="/logout">Disconnect</a>
                   </div>
                 </form>`
              : `<a class="btn" href="${escapeHtml(authUrl)}">Connect Google Account</a>`
          }
        </section>
        ${analysisSection}
      </main>
    </body>
  </html>`;
}

function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    name: "gsc_seo_session",
    secret: process.env.SESSION_SECRET || "change-me-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    }
  })
);

app.get("/", async (req, res) => {
  let connected = false;
  let authUrl = "/auth/google";
  let sites = [];
  let error = "";

  try {
    const oauthClient = getOAuthClientFromEnv();
    authUrl = getGoogleAuthUrl(oauthClient);

    if (req.session.tokens) {
      connected = true;
      applyCredentials(oauthClient, req.session.tokens);
      sites = await listAccessibleSites(oauthClient);
      req.session.tokens = { ...req.session.tokens, ...oauthClient.credentials };
    }
  } catch (err) {
    error = err.message;
  }

  res.status(200).send(
    renderPage({
      connected,
      authUrl,
      sites,
      error,
      result: req.session.lastResult || null
    })
  );
});

app.get("/auth/google", (req, res) => {
  try {
    const oauthClient = getOAuthClientFromEnv();
    res.redirect(getGoogleAuthUrl(oauthClient));
  } catch (err) {
    req.session.lastResult = null;
    res.status(500).send(renderPage({ connected: false, authUrl: "#", sites: [], error: err.message }));
  }
});

app.get("/auth/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) {
    res.redirect("/?error=missing_code");
    return;
  }
  try {
    const oauthClient = getOAuthClientFromEnv();
    const tokens = await exchangeCodeForTokens(oauthClient, String(code));
    req.session.tokens = tokens;
    req.session.lastResult = null;
    res.redirect("/");
  } catch (err) {
    res.status(500).send(
      renderPage({
        connected: false,
        authUrl: "#",
        sites: [],
        error: `OAuth callback failed: ${err.message}`,
        result: null
      })
    );
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.post("/analyze", async (req, res) => {
  if (!req.session.tokens) {
    res.redirect("/");
    return;
  }

  const siteUrl = String(req.body.siteUrl || "").trim();
  const startDate = String(req.body.startDate || "").trim();
  const endDate = String(req.body.endDate || "").trim();
  const minImpressions = parseNonNegativeInt(req.body.minImpressions, 200);
  const topN = parsePositiveInt(req.body.topN, 10);
  const trendWindowDays = parsePositiveInt(req.body.trendWindowDays, 28);

  if (!siteUrl || !startDate || !endDate) {
    res.status(400).send(
      renderPage({
        connected: true,
        authUrl: "#",
        sites: [],
        error: "siteUrl, startDate, and endDate are required.",
        result: req.session.lastResult || null
      })
    );
    return;
  }

  try {
    const oauthClient = getOAuthClientFromEnv();
    applyCredentials(oauthClient, req.session.tokens);

    const dimensions = ["query", "page", "date"];
    const rows = await fetchAllSearchAnalyticsRows(oauthClient, {
      siteUrl,
      startDate,
      endDate,
      dimensions
    });
    req.session.tokens = { ...req.session.tokens, ...oauthClient.credentials };

    const records = mapSearchAnalyticsRowsToRecords(rows, { siteUrl, dimensions });
    const analysis = analyzeRecords(records, {
      siteFilter: siteUrl,
      minImpressions,
      topN,
      trendWindowDays
    });
    const markdown = renderMarkdownReport(analysis);

    req.session.lastResult = {
      analysis,
      markdown,
      fetchedRows: rows.length,
      recordsCount: records.length,
      params: { siteUrl, startDate, endDate, minImpressions, topN, trendWindowDays }
    };

    res.redirect("/");
  } catch (err) {
    req.session.lastResult = null;
    res.status(500).send(
      renderPage({
        connected: true,
        authUrl: "#",
        sites: [],
        error: `Analysis failed: ${err.message}`,
        result: null
      })
    );
  }
});

app.listen(PORT, () => {
  process.stdout.write(`GSC dashboard running on http://localhost:${PORT}\n`);
});
