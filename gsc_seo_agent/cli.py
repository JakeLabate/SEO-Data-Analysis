from __future__ import annotations

import argparse
import sys

from .analyzer import (
    analyze_records,
    load_gsc_records,
    render_markdown_report,
    to_json,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Analyze Google Search Console CSV exports and produce SEO insights."
    )
    parser.add_argument("--input", required=True, help="Path to GSC CSV export file.")
    parser.add_argument(
        "--site",
        default="",
        help="Optional site_url/property filter when CSV contains multiple properties.",
    )
    parser.add_argument(
        "--min-impressions",
        type=int,
        default=200,
        help="Minimum impressions for opportunity detection.",
    )
    parser.add_argument(
        "--top-n",
        type=int,
        default=10,
        help="Number of top rows/opportunities to include.",
    )
    parser.add_argument(
        "--trend-window-days",
        type=int,
        default=28,
        help="Current-vs-previous comparison window size in days.",
    )
    parser.add_argument(
        "--output",
        default="",
        help="Optional markdown report path. Prints to stdout when omitted.",
    )
    parser.add_argument(
        "--json-output",
        default="",
        help="Optional JSON output path for machine-readable analysis.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        records = load_gsc_records(args.input)
        analysis = analyze_records(
            records,
            site_filter=args.site or None,
            min_impressions=args.min_impressions,
            top_n=args.top_n,
            trend_window_days=args.trend_window_days,
        )
    except Exception as exc:  # broad by design for CLI UX
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    report = render_markdown_report(analysis)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(report)
            handle.write("\n")
        print(f"Wrote markdown report: {args.output}")
    else:
        print(report)

    if args.json_output:
        payload = to_json(analysis)
        with open(args.json_output, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.write("\n")
        print(f"Wrote JSON output: {args.json_output}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
