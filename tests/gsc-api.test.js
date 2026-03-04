"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mapSearchAnalyticsRowsToRecords,
  normalizeSiteEntries
} = require("../src/gscApi");

test("normalizeSiteEntries keeps expected fields sorted", () => {
  const output = normalizeSiteEntries([
    { siteUrl: "https://b.example.com/", permissionLevel: "siteOwner" },
    { siteUrl: "", permissionLevel: "siteOwner" },
    { siteUrl: "https://a.example.com/", permissionLevel: "siteRestrictedUser" }
  ]);

  assert.deepEqual(output, [
    { siteUrl: "https://a.example.com/", permissionLevel: "siteRestrictedUser" },
    { siteUrl: "https://b.example.com/", permissionLevel: "siteOwner" }
  ]);
});

test("mapSearchAnalyticsRowsToRecords maps dimensions and metrics", () => {
  const rows = [
    {
      keys: ["seo audit", "https://example.com/seo-audit", "2026-02-28"],
      clicks: 11,
      impressions: 250,
      ctr: 0.044,
      position: 8.4
    }
  ];
  const dimensions = ["query", "page", "date"];

  const output = mapSearchAnalyticsRowsToRecords(rows, {
    siteUrl: "sc-domain:example.com",
    dimensions
  });

  assert.equal(output.length, 1);
  assert.deepEqual(output[0], {
    query: "seo audit",
    page: "https://example.com/seo-audit",
    date: "2026-02-28",
    country: "",
    device: "",
    site_url: "sc-domain:example.com",
    clicks: 11,
    impressions: 250,
    ctr: 0.044,
    position: 8.4
  });
});
