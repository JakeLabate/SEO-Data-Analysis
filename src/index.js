"use strict";

const {
  analyzeRecords,
  loadGscRecords,
  renderMarkdownReport,
  toJson
} = require("./analyzer");
const {
  applyCredentials,
  exchangeCodeForTokens,
  fetchAllSearchAnalyticsRows,
  getGoogleAuthUrl,
  getOAuthClientFromEnv,
  listAccessibleSites,
  mapSearchAnalyticsRowsToRecords
} = require("./gscApi");

module.exports = {
  applyCredentials,
  analyzeRecords,
  exchangeCodeForTokens,
  fetchAllSearchAnalyticsRows,
  getGoogleAuthUrl,
  getOAuthClientFromEnv,
  listAccessibleSites,
  loadGscRecords,
  mapSearchAnalyticsRowsToRecords,
  renderMarkdownReport,
  toJson
};
