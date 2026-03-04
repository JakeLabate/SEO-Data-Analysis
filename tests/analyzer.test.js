"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { analyzeRecords, loadGscRecords } = require("../src/analyzer");

function withTempCsv(content, callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gsc-agent-"));
  const filePath = path.join(dir, "input.csv");
  fs.writeFileSync(filePath, content, "utf8");
  try {
    callback(filePath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("loadGscRecords supports aliases and percent CTR", () => {
  const csvPayload = [
    "Search Query,URL,Clicks,Impressions,CTR,Average Position,Date",
    "seo tool,https://example.com/a,10,100,4.5%,7.2,2026-02-01"
  ].join("\n");

  withTempCsv(csvPayload, (filePath) => {
    const records = loadGscRecords(filePath);
    assert.equal(records.length, 1);
    const row = records[0];
    assert.equal(row.query, "seo tool");
    assert.equal(row.page, "https://example.com/a");
    assert.equal(row.clicks, 10);
    assert.equal(row.impressions, 100);
    assert.equal(row.date, "2026-02-01");
    assert.ok(Math.abs(row.ctr - 0.045) < 1e-8);
    assert.ok(Math.abs(row.position - 7.2) < 1e-8);
  });
});

test("analyzeRecords detects low CTR and rank lift opportunities", () => {
  const csvPayload = [
    "Query,Page,Clicks,Impressions,CTR,Position",
    "seo audit,https://ex.com/a,30,3000,1.0%,9.0",
    "technical seo,https://ex.com/b,45,900,5.0%,4.1",
    "seo checklist,https://ex.com/c,10,1200,0.83%,14.0"
  ].join("\n");

  withTempCsv(csvPayload, (filePath) => {
    const records = loadGscRecords(filePath);
    const analysis = analyzeRecords(records, { minImpressions: 200, topN: 5 });

    assert.equal(analysis.kpis.clicks, 85);
    assert.ok(analysis.opportunities.low_ctr_queries.length >= 1);
    assert.ok(analysis.opportunities.rank_lift_queries.length >= 1);
  });
});

test("analyzeRecords computes trend windows", () => {
  const csvPayload = [
    "Query,Page,Clicks,Impressions,CTR,Position,Date",
    "seo audit,https://ex.com/a,10,200,5%,7,2026-01-05",
    "seo audit,https://ex.com/a,10,200,5%,7,2026-01-10",
    "seo audit,https://ex.com/a,20,220,9.09%,6,2026-02-20",
    "seo audit,https://ex.com/a,20,220,9.09%,6,2026-02-25"
  ].join("\n");

  withTempCsv(csvPayload, (filePath) => {
    const records = loadGscRecords(filePath);
    const analysis = analyzeRecords(records, { trendWindowDays: 28 });

    assert.ok(analysis.trend);
    assert.equal(analysis.trend.current_clicks, 40);
    assert.equal(analysis.trend.previous_clicks, 20);
    assert.ok(analysis.trend.clicks_change_pct > 0);
  });
});
