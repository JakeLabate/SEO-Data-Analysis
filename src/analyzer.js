"use strict";

const fs = require("node:fs");

const HEADER_ALIASES = {
  query: new Set(["query", "searchquery", "topqueries", "searchterm"]),
  page: new Set(["page", "url", "landingpage", "targetpage"]),
  clicks: new Set(["clicks", "click"]),
  impressions: new Set(["impressions", "impression"]),
  ctr: new Set(["ctr", "clickthroughrate"]),
  position: new Set(["position", "avgposition", "averageposition"]),
  date: new Set(["date", "day"]),
  country: new Set(["country", "countrycode"]),
  device: new Set(["device"]),
  site_url: new Set(["siteurl", "site", "property", "domain"])
};

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeHeaders(rawHeaders) {
  const mapped = {};
  for (const rawHeader of rawHeaders) {
    const key = slug(rawHeader);
    for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.has(key)) {
        mapped[canonical] = rawHeader;
        break;
      }
    }
  }
  return mapped;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"") {
      const next = line[i + 1];
      if (inQuotes && next === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function parseCsv(content) {
  const lines = String(content)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error("CSV file is empty.");
  }

  const headers = parseCsvLine(lines[0]).map((cell) => cell.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j += 1) {
      row[headers[j]] = (cells[j] || "").trim();
    }
    rows.push(row);
  }
  return { headers, rows };
}

function parseIntSafe(value) {
  const cleaned = String(value || "").replaceAll(",", "").trim();
  if (!cleaned) return 0;
  const parsed = Number.parseInt(cleaned, 10);
  if (Number.isNaN(parsed)) return Math.trunc(Number.parseFloat(cleaned) || 0);
  return parsed;
}

function parseFloatSafe(value) {
  const cleaned = String(value || "").replaceAll(",", "").trim();
  if (!cleaned) return 0;
  const parsed = Number.parseFloat(cleaned);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseCtr(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  if (raw.endsWith("%")) {
    return parseFloatSafe(raw.slice(0, -1)) / 100;
  }
  const parsed = parseFloatSafe(raw);
  return parsed > 1 ? parsed / 100 : parsed;
}

function parseDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const [, month, day, year] = us;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const eu = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (eu) {
    const [, day, month, year] = eu;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return null;
}

function loadGscRecords(csvPath) {
  const content = fs.readFileSync(csvPath, "utf8");
  const { headers, rows } = parseCsv(content);
  const headerMap = normalizeHeaders(headers);
  const missing = ["clicks", "impressions"].filter((col) => !headerMap[col]);
  if (missing.length > 0) {
    throw new Error(
      `CSV is missing required columns: ${missing.join(", ")}. Expected at least clicks and impressions.`
    );
  }

  return rows.map((row) => {
    const get = (canonical) => {
      const sourceColumn = headerMap[canonical];
      return sourceColumn ? row[sourceColumn] || "" : "";
    };

    const clicks = parseIntSafe(get("clicks"));
    const impressions = parseIntSafe(get("impressions"));

    return {
      query: get("query").trim(),
      page: get("page").trim(),
      clicks,
      impressions,
      ctr: headerMap.ctr ? parseCtr(get("ctr")) : impressions > 0 ? clicks / impressions : 0,
      position: headerMap.position ? parseFloatSafe(get("position")) : 0,
      date: headerMap.date ? parseDate(get("date")) : null,
      country: get("country").trim(),
      device: get("device").trim(),
      site_url: get("site_url").trim()
    };
  });
}

function expectedCtrForPosition(position) {
  if (position <= 1) return 0.28;
  if (position <= 3) return 0.16;
  if (position <= 5) return 0.1;
  if (position <= 10) return 0.04;
  if (position <= 20) return 0.02;
  return 0.01;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function aggregateBy(records, keyFn) {
  const bucket = new Map();
  for (const record of records) {
    const key = keyFn(record) || "(not set)";
    if (!bucket.has(key)) {
      bucket.set(key, {
        clicks: 0,
        impressions: 0,
        positionImpressions: 0
      });
    }
    const item = bucket.get(key);
    item.clicks += record.clicks;
    item.impressions += record.impressions;
    item.positionImpressions += record.position * record.impressions;
  }

  const result = [];
  for (const [key, item] of bucket.entries()) {
    const ctr = item.impressions > 0 ? item.clicks / item.impressions : 0;
    const position = item.impressions > 0 ? item.positionImpressions / item.impressions : 0;
    result.push({
      key,
      clicks: item.clicks,
      impressions: item.impressions,
      ctr,
      position
    });
  }
  return result;
}

function shiftDate(dateIso, deltaDays) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function computeTrend(records, windowDays) {
  const dated = records.filter((record) => Boolean(record.date));
  if (dated.length === 0) return null;

  const maxDay = dated
    .map((record) => record.date)
    .sort()
    .at(-1);
  if (!maxDay) return null;

  const currentStart = shiftDate(maxDay, -(windowDays - 1));
  const previousStart = shiftDate(currentStart, -windowDays);
  const previousEnd = shiftDate(currentStart, -1);

  const current = dated.filter((record) => record.date >= currentStart && record.date <= maxDay);
  const previous = dated.filter(
    (record) => record.date >= previousStart && record.date <= previousEnd
  );
  if (current.length === 0 || previous.length === 0) return null;

  const summarize = (items) => {
    const clicks = items.reduce((sum, item) => sum + item.clicks, 0);
    const impressions = items.reduce((sum, item) => sum + item.impressions, 0);
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const positionWeighted = items.reduce(
      (sum, item) => sum + item.position * item.impressions,
      0
    );
    const position = impressions > 0 ? positionWeighted / impressions : 0;
    return { clicks, impressions, ctr, position };
  };

  const currentStats = summarize(current);
  const previousStats = summarize(previous);
  const pctChange = (curr, prev) => {
    if (prev === 0) return curr > 0 ? Number.POSITIVE_INFINITY : 0;
    return (curr - prev) / prev;
  };

  return {
    window_days: windowDays,
    current_clicks: currentStats.clicks,
    previous_clicks: previousStats.clicks,
    clicks_change_pct: pctChange(currentStats.clicks, previousStats.clicks),
    current_impressions: currentStats.impressions,
    previous_impressions: previousStats.impressions,
    impressions_change_pct: pctChange(currentStats.impressions, previousStats.impressions),
    current_ctr: currentStats.ctr,
    previous_ctr: previousStats.ctr,
    ctr_change_pct: pctChange(currentStats.ctr, previousStats.ctr),
    current_position: currentStats.position,
    previous_position: previousStats.position,
    position_change: currentStats.position - previousStats.position
  };
}

function analyzeRecords(
  records,
  { siteFilter = "", minImpressions = 200, topN = 10, trendWindowDays = 28 } = {}
) {
  const filtered = records.filter(
    (record) => !siteFilter || !record.site_url || record.site_url === siteFilter
  );
  if (filtered.length === 0) {
    throw new Error("No records available after applying the site filter.");
  }

  const totalClicks = filtered.reduce((sum, item) => sum + item.clicks, 0);
  const totalImpressions = filtered.reduce((sum, item) => sum + item.impressions, 0);
  const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
  const avgPosition =
    totalImpressions > 0
      ? filtered.reduce((sum, item) => sum + item.position * item.impressions, 0) /
        totalImpressions
      : 0;

  const byQuery = aggregateBy(filtered, (record) => record.query);
  const byPage = aggregateBy(filtered, (record) => record.page);

  const topQueries = [...byQuery]
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, topN)
    .map((row) => ({
      query: row.key,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position
    }));

  const topPages = [...byPage]
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, topN)
    .map((row) => ({
      page: row.key,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position
    }));

  const queryCtrs = byQuery
    .filter((row) => row.impressions >= minImpressions)
    .map((row) => row.ctr);
  const baselineCtr = queryCtrs.length > 0 ? median(queryCtrs) : ctr;

  const lowCtrQueries = [];
  const rankLiftQueries = [];

  for (const row of byQuery) {
    if (row.impressions < minImpressions) continue;
    const expectedCtr = Math.max(expectedCtrForPosition(row.position), baselineCtr);
    const potential = Math.max(0, Math.floor(row.impressions * expectedCtr - row.clicks));
    if (row.ctr < expectedCtr * 0.6 && potential > 0) {
      lowCtrQueries.push({
        query: row.key,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        potential_click_gain: potential
      });
    }

    if (row.position >= 8 && row.position <= 20) {
      const boostedCtr = Math.max(expectedCtrForPosition(5), baselineCtr);
      const rankLift = Math.max(0, Math.floor(row.impressions * boostedCtr - row.clicks));
      if (rankLift > 0) {
        rankLiftQueries.push({
          query: row.key,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
          potential_click_gain: rankLift
        });
      }
    }
  }

  lowCtrQueries.sort((a, b) => b.potential_click_gain - a.potential_click_gain);
  rankLiftQueries.sort((a, b) => b.potential_click_gain - a.potential_click_gain);

  return {
    site_filter: siteFilter,
    record_count: filtered.length,
    kpis: {
      clicks: totalClicks,
      impressions: totalImpressions,
      ctr,
      avg_position: avgPosition
    },
    top_queries: topQueries,
    top_pages: topPages,
    opportunities: {
      low_ctr_queries: lowCtrQueries.slice(0, topN),
      rank_lift_queries: rankLiftQueries.slice(0, topN)
    },
    trend: computeTrend(filtered, trendWindowDays)
  };
}

function toJson(analysis) {
  return JSON.stringify(analysis, null, 2);
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatChange(value) {
  if (!Number.isFinite(value)) return "∞";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function renderMarkdownReport(analysis) {
  const lines = [];
  lines.push("# SEO Analysis Report (GSC Data)");
  if (analysis.site_filter) {
    lines.push(`- **Property:** \`${analysis.site_filter}\``);
  }
  lines.push(`- **Rows analyzed:** ${analysis.record_count}`);
  lines.push("");
  lines.push("## KPI Snapshot");
  lines.push(`- **Clicks:** ${analysis.kpis.clicks.toLocaleString()}`);
  lines.push(`- **Impressions:** ${analysis.kpis.impressions.toLocaleString()}`);
  lines.push(`- **CTR:** ${formatPercent(analysis.kpis.ctr)}`);
  lines.push(`- **Avg Position:** ${analysis.kpis.avg_position.toFixed(2)}`);

  if (analysis.trend) {
    const trend = analysis.trend;
    lines.push("");
    lines.push(`## Trend (Last ${trend.window_days}d vs Prior Period)`);
    lines.push(
      `- **Clicks:** ${trend.current_clicks.toLocaleString()} (${formatChange(
        trend.clicks_change_pct
      )})`
    );
    lines.push(
      `- **Impressions:** ${trend.current_impressions.toLocaleString()} (${formatChange(
        trend.impressions_change_pct
      )})`
    );
    lines.push(`- **CTR:** ${formatPercent(trend.current_ctr)} (${formatChange(trend.ctr_change_pct)})`);
    lines.push(
      `- **Avg Position:** ${trend.current_position.toFixed(2)} (Δ ${trend.position_change.toFixed(
        2
      )})`
    );
  }

  lines.push("");
  lines.push("## Top Queries");
  lines.push("| Query | Clicks | Impressions | CTR | Position |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const row of analysis.top_queries) {
    lines.push(
      `| ${row.query || "(not set)"} | ${row.clicks.toLocaleString()} | ${row.impressions.toLocaleString()} | ${formatPercent(row.ctr)} | ${row.position.toFixed(2)} |`
    );
  }

  lines.push("");
  lines.push("## Top Pages");
  lines.push("| Page | Clicks | Impressions | CTR | Position |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const row of analysis.top_pages) {
    lines.push(
      `| ${row.page || "(not set)"} | ${row.clicks.toLocaleString()} | ${row.impressions.toLocaleString()} | ${formatPercent(row.ctr)} | ${row.position.toFixed(2)} |`
    );
  }

  lines.push("");
  lines.push("## High-Impact Opportunities");
  lines.push("");
  lines.push("### Low CTR for Existing Rankings");
  if (analysis.opportunities.low_ctr_queries.length === 0) {
    lines.push("- No low-CTR quick wins found above the impression threshold.");
  } else {
    for (const row of analysis.opportunities.low_ctr_queries) {
      lines.push(
        `- \`${row.query || "(not set)"}\`: ${row.impressions.toLocaleString()} impressions at ${formatPercent(
          row.ctr
        )} CTR, est. **+${row.potential_click_gain.toLocaleString()} clicks** if snippet/title performance improves.`
      );
    }
  }

  lines.push("");
  lines.push("### Position 8-20 Rank Lift Candidates");
  if (analysis.opportunities.rank_lift_queries.length === 0) {
    lines.push("- No rank-lift candidates found in positions 8-20.");
  } else {
    for (const row of analysis.opportunities.rank_lift_queries) {
      lines.push(
        `- \`${row.query || "(not set)"}\`: avg position ${row.position.toFixed(
          2
        )} with ${row.impressions.toLocaleString()} impressions, est. **+${row.potential_click_gain.toLocaleString()} clicks** from first-page improvement.`
      );
    }
  }

  lines.push("");
  lines.push("## Suggested Next Actions");
  lines.push("1. Refresh titles/meta for low-CTR queries with strong impressions.");
  lines.push("2. Build internal links and targeted content updates for rank-lift terms.");
  lines.push("3. Segment by page and device to prioritize technical/mobile wins.");
  lines.push("4. Re-run this analysis weekly and track changes in the trend section.");
  return lines.join("\n");
}

module.exports = {
  analyzeRecords,
  loadGscRecords,
  renderMarkdownReport,
  toJson
};
