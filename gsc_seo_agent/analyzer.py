from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
import csv
import json
import math
import re
from statistics import median
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


HEADER_ALIASES = {
    "query": {"query", "searchquery", "topqueries", "searchterm"},
    "page": {"page", "url", "landingpage", "targetpage"},
    "clicks": {"clicks", "click"},
    "impressions": {"impressions", "impression"},
    "ctr": {"ctr", "clickthroughrate"},
    "position": {"position", "avgposition", "averageposition"},
    "date": {"date", "day"},
    "country": {"country", "countrycode"},
    "device": {"device"},
    "site_url": {"siteurl", "site", "property", "domain"},
}


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower().strip())


def _normalize_headers(raw_headers: Sequence[str]) -> Dict[str, str]:
    mapped: Dict[str, str] = {}
    for raw in raw_headers:
        key = _slug(raw)
        for canonical, aliases in HEADER_ALIASES.items():
            if key in aliases:
                mapped[canonical] = raw
                break
    return mapped


def _parse_int(value: str) -> int:
    cleaned = (value or "").replace(",", "").strip()
    if not cleaned:
        return 0
    return int(float(cleaned))


def _parse_float(value: str) -> float:
    cleaned = (value or "").replace(",", "").strip()
    if not cleaned:
        return 0.0
    return float(cleaned)


def _parse_ctr(value: str) -> float:
    raw = (value or "").strip()
    if not raw:
        return 0.0
    if raw.endswith("%"):
        return _parse_float(raw[:-1]) / 100.0
    parsed = _parse_float(raw)
    # GSC exports often provide CTR as percent-like values in CSV.
    if parsed > 1:
        return parsed / 100.0
    return parsed


def _parse_date(value: str) -> Optional[date]:
    raw = (value or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


@dataclass(frozen=True)
class GSCRecord:
    query: str
    page: str
    clicks: int
    impressions: int
    ctr: float
    position: float
    date: Optional[date] = None
    country: str = ""
    device: str = ""
    site_url: str = ""


@dataclass(frozen=True)
class QueryPerformance:
    query: str
    clicks: int
    impressions: int
    ctr: float
    position: float
    potential_click_gain: int


def load_gsc_records(csv_path: str) -> List[GSCRecord]:
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError("CSV file has no header row.")
        header_map = _normalize_headers(reader.fieldnames)
        required = {"clicks", "impressions"}
        missing = required - set(header_map)
        if missing:
            raise ValueError(
                "CSV is missing required columns: "
                + ", ".join(sorted(missing))
                + ". Expected at least clicks and impressions."
            )

        records: List[GSCRecord] = []
        for row in reader:
            get = lambda canonical: row.get(header_map.get(canonical, ""), "")  # noqa: E731
            clicks = _parse_int(get("clicks"))
            impressions = _parse_int(get("impressions"))
            ctr = _parse_ctr(get("ctr")) if "ctr" in header_map else (clicks / impressions if impressions else 0.0)
            position = _parse_float(get("position")) if "position" in header_map else 0.0
            records.append(
                GSCRecord(
                    query=get("query").strip(),
                    page=get("page").strip(),
                    clicks=clicks,
                    impressions=impressions,
                    ctr=ctr,
                    position=position,
                    date=_parse_date(get("date")) if "date" in header_map else None,
                    country=get("country").strip(),
                    device=get("device").strip(),
                    site_url=get("site_url").strip(),
                )
            )
    return records


def _expected_ctr_for_position(position: float) -> float:
    if position <= 1:
        return 0.28
    if position <= 3:
        return 0.16
    if position <= 5:
        return 0.10
    if position <= 10:
        return 0.04
    if position <= 20:
        return 0.02
    return 0.01


def _aggregate_by(
    records: Iterable[GSCRecord], key_fn
) -> List[Tuple[str, int, int, float, float]]:
    bucket: Dict[str, Dict[str, float]] = {}
    for rec in records:
        key = key_fn(rec) or "(not set)"
        item = bucket.setdefault(
            key, {"clicks": 0.0, "impressions": 0.0, "position_impr": 0.0}
        )
        item["clicks"] += rec.clicks
        item["impressions"] += rec.impressions
        item["position_impr"] += rec.position * rec.impressions

    result = []
    for key, agg in bucket.items():
        impressions = int(agg["impressions"])
        clicks = int(agg["clicks"])
        ctr = (clicks / impressions) if impressions else 0.0
        avg_position = (agg["position_impr"] / impressions) if impressions else 0.0
        result.append((key, clicks, impressions, ctr, avg_position))
    return result


def _compute_trend(records: Sequence[GSCRecord], window_days: int) -> Optional[Dict[str, float]]:
    dated = [r for r in records if r.date is not None]
    if not dated:
        return None
    max_day = max(r.date for r in dated if r.date is not None)
    if max_day is None:
        return None
    current_start = max_day - timedelta(days=window_days - 1)
    previous_start = current_start - timedelta(days=window_days)
    previous_end = current_start - timedelta(days=1)

    current = [r for r in dated if r.date and current_start <= r.date <= max_day]
    previous = [r for r in dated if r.date and previous_start <= r.date <= previous_end]
    if not current or not previous:
        return None

    def summarize(items: Sequence[GSCRecord]) -> Dict[str, float]:
        clicks = sum(i.clicks for i in items)
        impr = sum(i.impressions for i in items)
        ctr = clicks / impr if impr else 0.0
        pos_weight = sum(i.position * i.impressions for i in items)
        pos = pos_weight / impr if impr else 0.0
        return {"clicks": clicks, "impressions": impr, "ctr": ctr, "position": pos}

    c = summarize(current)
    p = summarize(previous)

    def pct_change(curr: float, prev: float) -> float:
        if prev == 0:
            return math.inf if curr > 0 else 0.0
        return (curr - prev) / prev

    return {
        "window_days": window_days,
        "current_clicks": c["clicks"],
        "previous_clicks": p["clicks"],
        "clicks_change_pct": pct_change(c["clicks"], p["clicks"]),
        "current_impressions": c["impressions"],
        "previous_impressions": p["impressions"],
        "impressions_change_pct": pct_change(c["impressions"], p["impressions"]),
        "current_ctr": c["ctr"],
        "previous_ctr": p["ctr"],
        "ctr_change_pct": pct_change(c["ctr"], p["ctr"]),
        "current_position": c["position"],
        "previous_position": p["position"],
        "position_change": c["position"] - p["position"],
    }


def analyze_records(
    records: Sequence[GSCRecord],
    *,
    site_filter: Optional[str] = None,
    min_impressions: int = 200,
    top_n: int = 10,
    trend_window_days: int = 28,
) -> Dict[str, object]:
    filtered = [
        r
        for r in records
        if (not site_filter or not r.site_url or r.site_url == site_filter)
    ]
    if not filtered:
        raise ValueError("No records available after applying the site filter.")

    total_clicks = sum(r.clicks for r in filtered)
    total_impressions = sum(r.impressions for r in filtered)
    overall_ctr = total_clicks / total_impressions if total_impressions else 0.0
    weighted_position = (
        sum(r.position * r.impressions for r in filtered) / total_impressions
        if total_impressions
        else 0.0
    )

    by_query = _aggregate_by(filtered, lambda r: r.query)
    by_page = _aggregate_by(filtered, lambda r: r.page)

    top_queries = sorted(by_query, key=lambda x: x[1], reverse=True)[:top_n]
    top_pages = sorted(by_page, key=lambda x: x[1], reverse=True)[:top_n]

    query_ctrs = [item[3] for item in by_query if item[2] >= min_impressions]
    baseline_ctr = median(query_ctrs) if query_ctrs else overall_ctr

    low_ctr_queries: List[QueryPerformance] = []
    rank_lift_queries: List[QueryPerformance] = []
    for query, clicks, impr, ctr, pos in by_query:
        if impr < min_impressions:
            continue
        expected_ctr = max(_expected_ctr_for_position(pos), baseline_ctr)
        potential = max(0, int((impr * expected_ctr) - clicks))
        if ctr < expected_ctr * 0.6 and potential > 0:
            low_ctr_queries.append(
                QueryPerformance(query, clicks, impr, ctr, pos, potential)
            )
        if 8 <= pos <= 20:
            boosted_ctr = max(_expected_ctr_for_position(5), baseline_ctr)
            rank_lift = max(0, int((impr * boosted_ctr) - clicks))
            if rank_lift > 0:
                rank_lift_queries.append(
                    QueryPerformance(query, clicks, impr, ctr, pos, rank_lift)
                )

    low_ctr_queries.sort(key=lambda q: q.potential_click_gain, reverse=True)
    rank_lift_queries.sort(key=lambda q: q.potential_click_gain, reverse=True)

    trend = _compute_trend(filtered, trend_window_days)

    result: Dict[str, object] = {
        "site_filter": site_filter or "",
        "record_count": len(filtered),
        "kpis": {
            "clicks": total_clicks,
            "impressions": total_impressions,
            "ctr": overall_ctr,
            "avg_position": weighted_position,
        },
        "top_queries": [
            {
                "query": q,
                "clicks": c,
                "impressions": i,
                "ctr": ctr,
                "position": pos,
            }
            for q, c, i, ctr, pos in top_queries
        ],
        "top_pages": [
            {"page": p, "clicks": c, "impressions": i, "ctr": ctr, "position": pos}
            for p, c, i, ctr, pos in top_pages
        ],
        "opportunities": {
            "low_ctr_queries": [q.__dict__ for q in low_ctr_queries[:top_n]],
            "rank_lift_queries": [q.__dict__ for q in rank_lift_queries[:top_n]],
        },
        "trend": trend,
    }
    return result


def to_json(analysis: Dict[str, object]) -> str:
    return json.dumps(analysis, indent=2, default=str)


def _fmt_pct(value: float) -> str:
    return f"{value * 100:.2f}%"


def _fmt_change(value: float) -> str:
    if math.isinf(value):
        return "∞"
    sign = "+" if value > 0 else ""
    return f"{sign}{value * 100:.2f}%"


def render_markdown_report(analysis: Dict[str, object]) -> str:
    kpis = analysis["kpis"]  # type: ignore[index]
    trend = analysis.get("trend")
    top_queries = analysis["top_queries"]  # type: ignore[index]
    top_pages = analysis["top_pages"]  # type: ignore[index]
    opportunities = analysis["opportunities"]  # type: ignore[index]
    low_ctr = opportunities["low_ctr_queries"]  # type: ignore[index]
    rank_lift = opportunities["rank_lift_queries"]  # type: ignore[index]

    lines: List[str] = []
    lines.append("# SEO Analysis Report (GSC Data)")
    if analysis.get("site_filter"):
        lines.append(f"- **Property:** `{analysis['site_filter']}`")
    lines.append(f"- **Rows analyzed:** {analysis['record_count']}")
    lines.append("")
    lines.append("## KPI Snapshot")
    lines.append(f"- **Clicks:** {kpis['clicks']:,}")
    lines.append(f"- **Impressions:** {kpis['impressions']:,}")
    lines.append(f"- **CTR:** {_fmt_pct(kpis['ctr'])}")
    lines.append(f"- **Avg Position:** {kpis['avg_position']:.2f}")

    if trend:
        lines.append("")
        lines.append(f"## Trend (Last {trend['window_days']}d vs Prior Period)")
        lines.append(
            f"- **Clicks:** {trend['current_clicks']:,} ({_fmt_change(trend['clicks_change_pct'])})"
        )
        lines.append(
            f"- **Impressions:** {trend['current_impressions']:,} ({_fmt_change(trend['impressions_change_pct'])})"
        )
        lines.append(
            f"- **CTR:** {_fmt_pct(trend['current_ctr'])} ({_fmt_change(trend['ctr_change_pct'])})"
        )
        lines.append(
            f"- **Avg Position:** {trend['current_position']:.2f} (Δ {trend['position_change']:+.2f})"
        )

    lines.append("")
    lines.append("## Top Queries")
    lines.append("| Query | Clicks | Impressions | CTR | Position |")
    lines.append("|---|---:|---:|---:|---:|")
    for row in top_queries:
        lines.append(
            f"| {row['query'] or '(not set)'} | {row['clicks']:,} | {row['impressions']:,} | {_fmt_pct(row['ctr'])} | {row['position']:.2f} |"
        )

    lines.append("")
    lines.append("## Top Pages")
    lines.append("| Page | Clicks | Impressions | CTR | Position |")
    lines.append("|---|---:|---:|---:|---:|")
    for row in top_pages:
        lines.append(
            f"| {row['page'] or '(not set)'} | {row['clicks']:,} | {row['impressions']:,} | {_fmt_pct(row['ctr'])} | {row['position']:.2f} |"
        )

    lines.append("")
    lines.append("## High-Impact Opportunities")
    lines.append("")
    lines.append("### Low CTR for Existing Rankings")
    if not low_ctr:
        lines.append("- No low-CTR quick wins found above the impression threshold.")
    else:
        for row in low_ctr:
            lines.append(
                f"- `{row['query'] or '(not set)'}`: {row['impressions']:,} impressions at {_fmt_pct(row['ctr'])} CTR, est. **+{row['potential_click_gain']:,} clicks** if snippet/title performance improves."
            )

    lines.append("")
    lines.append("### Position 8-20 Rank Lift Candidates")
    if not rank_lift:
        lines.append("- No rank-lift candidates found in positions 8-20.")
    else:
        for row in rank_lift:
            lines.append(
                f"- `{row['query'] or '(not set)'}`: avg position {row['position']:.2f} with {row['impressions']:,} impressions, est. **+{row['potential_click_gain']:,} clicks** from first-page improvement."
            )

    lines.append("")
    lines.append("## Suggested Next Actions")
    lines.append("1. Refresh titles/meta for low-CTR queries with strong impressions.")
    lines.append("2. Build internal links and targeted content updates for rank-lift terms.")
    lines.append("3. Segment by page and device to prioritize technical/mobile wins.")
    lines.append("4. Re-run this analysis weekly and track changes in the trend section.")
    return "\n".join(lines)
