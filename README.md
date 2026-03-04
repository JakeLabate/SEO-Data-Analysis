# GSC SEO Analysis Agent (JavaScript)

Lightweight JavaScript/Node agent that performs SEO analysis from Google Search Console (GSC) CSV exports.

## What it does

- Ingests GSC Search Analytics CSV data (with flexible header matching)
- Calculates key KPIs:
  - total clicks
  - total impressions
  - weighted CTR
  - weighted average position
- Finds high-impact opportunities:
  - low CTR queries with strong visibility
  - position 8-20 queries with rank-lift potential
- Computes trend deltas (last N days vs previous N days) when `Date` exists
- Produces:
  - Markdown report (human-readable)
  - JSON analysis payload (machine-readable)

## Quick start

```bash
node bin/gsc-seo-agent.js --input "/path/to/gsc-export.csv" --output report.md --json-output report.json
```

or with npm:

```bash
npm start -- --input "/path/to/gsc-export.csv" --output report.md --json-output report.json
```

### Optional flags

- `--site "sc-domain:example.com"`: filter a single property if multiple are present
- `--min-impressions 300`: minimum impressions for opportunity detection
- `--top-n 15`: include more rows in top tables/opportunities
- `--trend-window-days 28`: window size for current vs prior period comparison

## Input format

The agent expects a CSV with at least:

- `Clicks`
- `Impressions`

It can also use (recommended):

- `Query`
- `Page` / `URL`
- `CTR`
- `Position` / `Average Position`
- `Date`
- `Country`
- `Device`
- `Site URL` / `Property`

Header matching is case-insensitive and tolerant of common aliases.

## Run tests

```bash
npm test
```

## Typical workflow

1. Export Search Results data from GSC to CSV.
2. Run the agent against the export.
3. Review the Markdown report’s opportunities section.
4. Prioritize title/meta updates, internal linking, and content refreshes.
5. Re-run weekly to track trend movement.
