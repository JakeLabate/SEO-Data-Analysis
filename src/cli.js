"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  analyzeRecords,
  loadGscRecords,
  renderMarkdownReport,
  toJson
} = require("./analyzer");

function parseArgs(argv) {
  const args = {
    input: "",
    site: "",
    minImpressions: 200,
    topN: 10,
    trendWindowDays: 28,
    output: "",
    jsonOutput: ""
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--input":
        args.input = next || "";
        i += 1;
        break;
      case "--site":
        args.site = next || "";
        i += 1;
        break;
      case "--min-impressions":
        args.minImpressions = Number.parseInt(next || "", 10);
        i += 1;
        break;
      case "--top-n":
        args.topN = Number.parseInt(next || "", 10);
        i += 1;
        break;
      case "--trend-window-days":
        args.trendWindowDays = Number.parseInt(next || "", 10);
        i += 1;
        break;
      case "--output":
        args.output = next || "";
        i += 1;
        break;
      case "--json-output":
        args.jsonOutput = next || "";
        i += 1;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown argument: ${arg}`);
        }
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node bin/gsc-seo-agent.js --input /path/to/gsc.csv [options]",
    "",
    "Options:",
    "  --site <value>               Optional site_url filter",
    "  --min-impressions <number>   Minimum impressions for opportunities (default: 200)",
    "  --top-n <number>             Number of top rows/opportunities (default: 10)",
    "  --trend-window-days <number> Window length for trend comparison (default: 28)",
    "  --output <path>              Optional markdown output path",
    "  --json-output <path>         Optional JSON output path",
    "  -h, --help                   Show this help message"
  ].join("\n");
}

function resolvePath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    if (!args.input) {
      throw new Error("Missing required --input argument.");
    }
    if (!Number.isFinite(args.minImpressions) || args.minImpressions < 0) {
      throw new Error("--min-impressions must be a non-negative integer.");
    }
    if (!Number.isFinite(args.topN) || args.topN <= 0) {
      throw new Error("--top-n must be a positive integer.");
    }
    if (!Number.isFinite(args.trendWindowDays) || args.trendWindowDays <= 0) {
      throw new Error("--trend-window-days must be a positive integer.");
    }

    const records = loadGscRecords(resolvePath(args.input));
    const analysis = analyzeRecords(records, {
      siteFilter: args.site,
      minImpressions: args.minImpressions,
      topN: args.topN,
      trendWindowDays: args.trendWindowDays
    });

    const report = renderMarkdownReport(analysis);
    if (args.output) {
      const outPath = resolvePath(args.output);
      fs.writeFileSync(outPath, `${report}\n`, "utf8");
      process.stdout.write(`Wrote markdown report: ${outPath}\n`);
    } else {
      process.stdout.write(`${report}\n`);
    }

    if (args.jsonOutput) {
      const jsonPath = resolvePath(args.jsonOutput);
      fs.writeFileSync(jsonPath, `${toJson(analysis)}\n`, "utf8");
      process.stdout.write(`Wrote JSON output: ${jsonPath}\n`);
    }
    return 0;
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    return 1;
  }
}

module.exports = {
  main,
  parseArgs,
  usage
};
