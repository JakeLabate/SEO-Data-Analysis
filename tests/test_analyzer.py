from datetime import date
import tempfile
import textwrap
import unittest

from gsc_seo_agent.analyzer import analyze_records, load_gsc_records


class AnalyzerTests(unittest.TestCase):
    def test_load_gsc_records_with_header_aliases_and_ctr_percent(self) -> None:
        csv_payload = textwrap.dedent(
            """\
            Search Query,URL,Clicks,Impressions,CTR,Average Position,Date
            seo tool,https://example.com/a,10,100,4.5%,7.2,2026-02-01
            """
        )
        with tempfile.NamedTemporaryFile("w+", suffix=".csv", delete=True) as handle:
            handle.write(csv_payload)
            handle.flush()
            records = load_gsc_records(handle.name)

        self.assertEqual(len(records), 1)
        row = records[0]
        self.assertEqual(row.query, "seo tool")
        self.assertEqual(row.page, "https://example.com/a")
        self.assertEqual(row.clicks, 10)
        self.assertEqual(row.impressions, 100)
        self.assertAlmostEqual(row.ctr, 0.045, places=6)
        self.assertAlmostEqual(row.position, 7.2, places=4)
        self.assertEqual(row.date, date(2026, 2, 1))

    def test_analyze_records_detects_opportunities(self) -> None:
        csv_payload = textwrap.dedent(
            """\
            Query,Page,Clicks,Impressions,CTR,Position
            seo audit,https://ex.com/a,30,3000,1.0%,9.0
            technical seo,https://ex.com/b,45,900,5.0%,4.1
            seo checklist,https://ex.com/c,10,1200,0.83%,14.0
            """
        )
        with tempfile.NamedTemporaryFile("w+", suffix=".csv", delete=True) as handle:
            handle.write(csv_payload)
            handle.flush()
            records = load_gsc_records(handle.name)

        analysis = analyze_records(records, min_impressions=200, top_n=5)
        self.assertEqual(analysis["kpis"]["clicks"], 85)
        self.assertTrue(len(analysis["opportunities"]["low_ctr_queries"]) >= 1)
        self.assertTrue(len(analysis["opportunities"]["rank_lift_queries"]) >= 1)

    def test_analyze_records_computes_trend(self) -> None:
        csv_payload = textwrap.dedent(
            """\
            Query,Page,Clicks,Impressions,CTR,Position,Date
            seo audit,https://ex.com/a,10,200,5%,7,2026-01-05
            seo audit,https://ex.com/a,10,200,5%,7,2026-01-10
            seo audit,https://ex.com/a,20,220,9.09%,6,2026-02-20
            seo audit,https://ex.com/a,20,220,9.09%,6,2026-02-25
            """
        )
        with tempfile.NamedTemporaryFile("w+", suffix=".csv", delete=True) as handle:
            handle.write(csv_payload)
            handle.flush()
            records = load_gsc_records(handle.name)

        analysis = analyze_records(records, trend_window_days=28)
        self.assertIsNotNone(analysis["trend"])
        trend = analysis["trend"]
        self.assertEqual(trend["current_clicks"], 40)
        self.assertEqual(trend["previous_clicks"], 20)
        self.assertGreater(trend["clicks_change_pct"], 0)


if __name__ == "__main__":
    unittest.main()
