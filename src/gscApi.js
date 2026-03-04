"use strict";

const { google } = require("googleapis");

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

function getOAuthClientFromEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/auth/callback";

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET. Add them to your environment."
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getGoogleAuthUrl(oauthClient) {
  return oauthClient.generateAuthUrl({
    access_type: "offline",
    scope: [GSC_SCOPE],
    include_granted_scopes: true,
    prompt: "consent"
  });
}

async function exchangeCodeForTokens(oauthClient, code) {
  const { tokens } = await oauthClient.getToken(code);
  return tokens;
}

function applyCredentials(oauthClient, tokens) {
  oauthClient.setCredentials(tokens);
}

function normalizeSiteEntries(siteEntryList = []) {
  return siteEntryList
    .map((entry) => ({
      siteUrl: entry.siteUrl || "",
      permissionLevel: entry.permissionLevel || ""
    }))
    .filter((entry) => Boolean(entry.siteUrl))
    .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

async function listAccessibleSites(oauthClient) {
  const webmasters = google.webmasters({ version: "v3", auth: oauthClient });
  const response = await webmasters.sites.list();
  return normalizeSiteEntries(response.data.siteEntry || []);
}

async function fetchAllSearchAnalyticsRows(
  oauthClient,
  {
    siteUrl,
    startDate,
    endDate,
    dimensions = ["query", "page", "date"],
    type = "web",
    rowLimit = 25000,
    maxRows = 100000
  }
) {
  const webmasters = google.webmasters({ version: "v3", auth: oauthClient });
  const rows = [];
  let startRow = 0;

  while (rows.length < maxRows) {
    const response = await webmasters.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions,
        type,
        rowLimit: Math.min(rowLimit, maxRows - rows.length),
        startRow
      }
    });

    const pageRows = response.data.rows || [];
    if (pageRows.length === 0) break;

    rows.push(...pageRows);
    if (pageRows.length < rowLimit) break;
    startRow += rowLimit;
  }

  return rows;
}

function mapSearchAnalyticsRowsToRecords(rows, { siteUrl, dimensions }) {
  return rows.map((row) => {
    const keys = Array.isArray(row.keys) ? row.keys : [];
    const dimMap = {};
    for (let i = 0; i < dimensions.length; i += 1) {
      dimMap[dimensions[i]] = keys[i] || "";
    }

    const clicks = Number(row.clicks || 0);
    const impressions = Number(row.impressions || 0);

    return {
      query: dimMap.query || "",
      page: dimMap.page || "",
      date: dimMap.date || null,
      country: dimMap.country || "",
      device: dimMap.device || "",
      site_url: siteUrl,
      clicks,
      impressions,
      ctr: Number.isFinite(row.ctr) ? Number(row.ctr) : impressions > 0 ? clicks / impressions : 0,
      position: Number(row.position || 0)
    };
  });
}

module.exports = {
  GSC_SCOPE,
  applyCredentials,
  exchangeCodeForTokens,
  fetchAllSearchAnalyticsRows,
  getGoogleAuthUrl,
  getOAuthClientFromEnv,
  listAccessibleSites,
  mapSearchAnalyticsRowsToRecords,
  normalizeSiteEntries
};
