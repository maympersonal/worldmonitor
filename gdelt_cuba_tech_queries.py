#!/usr/bin/env python3
"""
Run Cuba tech/telecom queries against the GDELT DOC 2.0 API.

Usage:
  python gdelt_cuba_tech_queries.py
  python gdelt_cuba_tech_queries.py --timespan 180d --maxrecords 50 --out gdelt_cuba_tech.json
  python gdelt_cuba_tech_queries.py --analysis-only
"""

from __future__ import annotations

import argparse
import json
import re
import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
# Public endpoint limit is roughly 1 request every 5 seconds.
MIN_SECONDS_BETWEEN_REQUESTS = 6.2
MAX_RETRY_ATTEMPTS = 3
TITLE_TOKEN_RE = re.compile(r"\b[\w-]{3,}\b", flags=re.UNICODE)
CUBA_RELEVANCE_RE = re.compile(r"\b(cuba|habana|havana|cuban|cubano|cubana)\b", flags=re.IGNORECASE)
TECH_TITLE_SIGNALS: List[tuple[str, re.Pattern[str], int]] = [
    ("software", re.compile(r"\bsoftware\b", flags=re.IGNORECASE), 2),
    ("digital transformation", re.compile(r"\bdigital transformation\b", flags=re.IGNORECASE), 3),
    ("transformacion digital", re.compile(r"\btransformaci[oó]n digital\b", flags=re.IGNORECASE), 3),
    ("digitalization", re.compile(r"\bdigitali[sz]ation\b", flags=re.IGNORECASE), 2),
    ("digitalizacion", re.compile(r"\bdigitalizaci[oó]n\b", flags=re.IGNORECASE), 2),
    ("innovation", re.compile(r"\binnovation\b", flags=re.IGNORECASE), 2),
    ("innovacion", re.compile(r"\binnovaci[oó]n\b", flags=re.IGNORECASE), 2),
    ("internet", re.compile(r"\binternet\b", flags=re.IGNORECASE), 2),
    ("4G", re.compile(r"\b4g\b", flags=re.IGNORECASE), 2),
    ("5G", re.compile(r"\b5g\b", flags=re.IGNORECASE), 2),
    ("fibra", re.compile(r"\bfibra\b", flags=re.IGNORECASE), 2),
    ("fiber", re.compile(r"\bfib(?:er|re)\b", flags=re.IGNORECASE), 2),
    ("mobile data", re.compile(r"\bmobile data\b", flags=re.IGNORECASE), 2),
    ("datos moviles", re.compile(r"\bdatos m[oó]viles\b", flags=re.IGNORECASE), 2),
    ("connectivity", re.compile(r"\bconnectivity\b", flags=re.IGNORECASE), 2),
    ("conectividad", re.compile(r"\bconectividad\b", flags=re.IGNORECASE), 2),
    ("broadband", re.compile(r"\bbroadband\b", flags=re.IGNORECASE), 2),
    ("banda ancha", re.compile(r"\bbanda ancha\b", flags=re.IGNORECASE), 2),
    ("telecommunications", re.compile(r"\btelecommunications?\b", flags=re.IGNORECASE), 2),
    ("telecomunicaciones", re.compile(r"\btelecomunicaciones\b", flags=re.IGNORECASE), 2),
    ("ETECSA", re.compile(r"\betecsa\b", flags=re.IGNORECASE), 3),
]
TITLE_STOPWORDS = {
    "para",
    "sobre",
    "desde",
    "entre",
    "hacia",
    "cuba",
    "habana",
    "cubano",
    "cubana",
    "con",
    "sin",
    "los",
    "las",
    "the",
    "and",
    "for",
    "from",
    "with",
    "that",
    "this",
    "into",
    "cuban",
}


@dataclass(frozen=True)
class QuerySpec:
    name: str
    query: str


TECH_QUERIES: List[QuerySpec] = [
    QuerySpec(
        name="Cuba Tecnologia (ES)",
        query='(Cuba OR Habana OR cubano OR cubana) (tecnologia OR digitalizacion OR software OR "transformacion digital" OR innovacion) sourcelang:spanish',
    ),
    QuerySpec(
        name="Cuba Technology (EN)",
        query='(Cuba OR Habana OR cuban) (technology OR digitalization OR software OR "digital transformation" OR innovation) sourcelang:english',
    ),
    QuerySpec(
        name="Cuba Telecom (ES)",
        query='(Cuba OR ETECSA OR "Ministerio de Comunicaciones") (internet OR conectividad OR "banda ancha" OR 4G OR 5G OR fibra OR "datos moviles") sourcelang:spanish',
    ),
    QuerySpec(
        name="Cuba Telecom (EN)",
        query='(Cuba OR ETECSA OR "Ministry of Communications") (internet OR connectivity OR broadband OR 4G OR 5G OR fiber OR "mobile data") sourcelang:english',
    ),
]


def map_article(article: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "title": article.get("title"),
        "url": article.get("url"),
        "source": article.get("domain") or (article.get("source") or {}).get("domain"),
        "date": article.get("seendate"),
        "language": article.get("language"),
        "tone": article.get("tone"),
    }


def is_cuba_relevant(article: Dict[str, Any]) -> bool:
    haystack = " ".join(
        [
            str(article.get("title") or ""),
            str(article.get("url") or ""),
            str(article.get("source") or ""),
        ]
    )
    return bool(CUBA_RELEVANCE_RE.search(haystack))


def score_tech_title(title: str) -> tuple[int, List[str]]:
    score = 0
    matched_terms: List[str] = []
    source = title or ""
    for label, pattern, points in TECH_TITLE_SIGNALS:
        if pattern.search(source):
            score += points
            matched_terms.append(label)
    return score, matched_terms


def parse_article_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    if len(text) >= 15 and text[:8].isdigit() and text[8] == "T":
        try:
            return datetime.strptime(text[:15], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
        except ValueError:
            pass

    if text.endswith("Z"):
        text = text.replace("Z", "+00:00")

    try:
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return None


def bucket_date(value: Any) -> Optional[str]:
    parsed = parse_article_datetime(value)
    if parsed is not None:
        return parsed.date().isoformat()

    text = str(value or "").strip()
    if len(text) >= 8 and text[:8].isdigit():
        return f"{text[0:4]}-{text[4:6]}-{text[6:8]}"
    return None


def extract_title_terms(title: str) -> List[str]:
    words = TITLE_TOKEN_RE.findall((title or "").lower())
    return [
        word
        for word in words
        if word not in TITLE_STOPWORDS and not word.isdigit() and len(word) > 2
    ]


def summarize_articles(articles: List[Dict[str, Any]]) -> Dict[str, Any]:
    sources = Counter()
    languages = Counter()
    days = Counter()
    keywords = Counter()
    tones: List[float] = []
    tone_buckets = Counter({"negative": 0, "neutral": 0, "positive": 0})
    latest_article: Optional[Dict[str, Any]] = None
    latest_dt: Optional[datetime] = None

    for article in articles:
        source = (article.get("source") or "").strip()
        if source:
            sources[source] += 1

        language = (article.get("language") or "").strip().lower()
        if language:
            languages[language] += 1

        day = bucket_date(article.get("date"))
        if day:
            days[day] += 1

        title = article.get("title") or ""
        for term in extract_title_terms(title):
            keywords[term] += 1

        raw_tone = article.get("tone")
        try:
            tone = float(raw_tone)
            tones.append(tone)
            if tone <= -2:
                tone_buckets["negative"] += 1
            elif tone >= 2:
                tone_buckets["positive"] += 1
            else:
                tone_buckets["neutral"] += 1
        except (TypeError, ValueError):
            pass

        article_dt = parse_article_datetime(article.get("date"))
        if article_dt is not None and (latest_dt is None or article_dt > latest_dt):
            latest_dt = article_dt
            latest_article = {
                "title": article.get("title"),
                "url": article.get("url"),
                "source": article.get("source"),
                "date": article.get("date"),
            }

    sorted_days = sorted(days.items(), key=lambda item: item[0], reverse=True)
    top_sources = [{"source": source, "count": count} for source, count in sources.most_common(10)]
    top_keywords = [{"term": term, "count": count} for term, count in keywords.most_common(15)]

    tone_stats: Dict[str, Any] = {
        "sample_size": len(tones),
        "distribution": {
            "negative": tone_buckets["negative"],
            "neutral": tone_buckets["neutral"],
            "positive": tone_buckets["positive"],
        },
    }
    if tones:
        tone_stats.update(
            {
                "avg": round(sum(tones) / len(tones), 3),
                "min": round(min(tones), 3),
                "max": round(max(tones), 3),
            }
        )

    return {
        "article_count": len(articles),
        "top_sources": top_sources,
        "languages": dict(languages.most_common()),
        "daily_volume": [{"date": day, "count": count} for day, count in sorted_days],
        "top_keywords": top_keywords,
        "tone": tone_stats,
        "latest_article": latest_article,
    }


def truncate_text(value: Any, limit: int = 220) -> str:
    text = str(value or "")
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


def compute_retry_after_seconds(response: requests.Response, default_seconds: float = 7.0) -> float:
    retry_after_raw = response.headers.get("Retry-After")
    if retry_after_raw is not None:
        try:
            retry_after = float(retry_after_raw)
            if retry_after > 0:
                return retry_after
        except ValueError:
            pass
    return default_seconds


def is_rate_limit_message(text_body: str) -> bool:
    lowered = (text_body or "").lower()
    return "please limit requests to one every 5 seconds" in lowered or "rate limit" in lowered


def build_analysis(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_query: List[Dict[str, Any]] = []
    all_articles: List[Dict[str, Any]] = []
    query_errors: List[Dict[str, Any]] = []

    for result in results:
        articles = result.get("articles", [])
        query_summary = summarize_articles(articles)
        query_summary["name"] = result.get("name")
        query_summary["query"] = result.get("query")
        query_summary["result_count"] = result.get("count", len(articles))

        if result.get("error"):
            short_error = truncate_text(result["error"])
            query_summary["error"] = short_error
            query_errors.append({"name": result.get("name"), "error": short_error})

        by_query.append(query_summary)
        all_articles.extend(articles)

    overall = summarize_articles(all_articles)
    overall["query_count"] = len(results)
    overall["queries_with_error"] = len(query_errors)
    overall["query_errors"] = query_errors

    return {
        "overall": overall,
        "by_query": by_query,
    }


def fetch_gdelt(
    session: requests.Session,
    spec: QuerySpec,
    *,
    timespan: str,
    maxrecords: int,
    sort: str,
    retry_delay_seconds: float = MIN_SECONDS_BETWEEN_REQUESTS,
    min_tech_score: int = 0,
) -> Dict[str, Any]:
    params = {
        "query": spec.query,
        "mode": "artlist",
        "format": "json",
        "maxrecords": str(maxrecords),
        "sort": sort,
        "timespan": timespan,
    }
    wait_seconds = max(MIN_SECONDS_BETWEEN_REQUESTS, retry_delay_seconds)

    for attempt in range(1, MAX_RETRY_ATTEMPTS + 1):
        try:
            response = session.get(GDELT_DOC_URL, params=params, timeout=30)
        except requests.RequestException as exc:
            if attempt < MAX_RETRY_ATTEMPTS:
                time.sleep(wait_seconds)
                continue
            return {
                "name": spec.name,
                "query": spec.query,
                "articles": [],
                "count": 0,
                "error": f"request_error: {exc}",
            }

        text_body = response.text.strip()
        if not response.ok:
            if response.status_code == 429 and attempt < MAX_RETRY_ATTEMPTS:
                retry_after = compute_retry_after_seconds(response, default_seconds=wait_seconds + 1.0)
                time.sleep(retry_after)
                continue
            return {
                "name": spec.name,
                "query": spec.query,
                "articles": [],
                "count": 0,
                "error": f"http_{response.status_code}",
                "details": text_body[:500],
            }

        content_type = response.headers.get("content-type", "").lower()
        if "json" not in content_type:
            # GDELT often returns plain-text messages when rate-limited.
            if is_rate_limit_message(text_body) and attempt < MAX_RETRY_ATTEMPTS:
                time.sleep(wait_seconds + 1.0)
                continue
            return {
                "name": spec.name,
                "query": spec.query,
                "articles": [],
                "count": 0,
                "error": "non_json_response",
                "details": text_body[:500],
            }

        try:
            payload = response.json()
        except ValueError:
            if attempt < MAX_RETRY_ATTEMPTS:
                time.sleep(wait_seconds)
                continue
            return {
                "name": spec.name,
                "query": spec.query,
                "articles": [],
                "count": 0,
                "error": "invalid_json",
                "details": text_body[:500],
            }

        raw_articles = [map_article(article) for article in payload.get("articles", [])]
        cuba_relevant_articles = [article for article in raw_articles if is_cuba_relevant(article)]
        filtered_by_cuba = max(0, len(raw_articles) - len(cuba_relevant_articles))

        articles: List[Dict[str, Any]] = []
        filtered_by_tech_score = 0
        for article in cuba_relevant_articles:
            tech_score, tech_terms = score_tech_title(str(article.get("title") or ""))
            enriched = {
                **article,
                "tech_score": tech_score,
                "tech_terms": tech_terms,
            }
            if tech_score < min_tech_score:
                filtered_by_tech_score += 1
                continue
            articles.append(enriched)

        articles.sort(
            key=lambda item: (
                int(item.get("tech_score", 0)),
                parse_article_datetime(item.get("date")) or datetime.min.replace(tzinfo=timezone.utc),
            ),
            reverse=True,
        )
        return {
            "name": spec.name,
            "query": spec.query,
            "articles": articles,
            "count": len(articles),
            "raw_count": len(raw_articles),
            "filtered_out": max(0, len(raw_articles) - len(articles)),
            "filtered_by_cuba": filtered_by_cuba,
            "filtered_by_tech_score": filtered_by_tech_score,
        }

    return {
        "name": spec.name,
        "query": spec.query,
        "articles": [],
        "count": 0,
        "error": "unknown_error",
        "details": "Unexpected retry exhaustion.",
    }


def run_queries(
    *,
    timespan: str,
    maxrecords: int,
    sort: str,
    delay_seconds: float,
    min_tech_score: int,
) -> Dict[str, Any]:
    results: List[Dict[str, Any]] = []

    with requests.Session() as session:
        session.headers.update(
            {
                "Accept": "application/json",
                "User-Agent": "worldmonitor-gdelt-script/1.0",
            }
        )

        for index, spec in enumerate(TECH_QUERIES):
            if index > 0:
                time.sleep(delay_seconds)
            results.append(
                fetch_gdelt(
                    session,
                    spec,
                    timespan=timespan,
                    maxrecords=maxrecords,
                    sort=sort,
                    retry_delay_seconds=delay_seconds,
                    min_tech_score=min_tech_score,
                )
            )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "timespan": timespan,
        "maxrecords": maxrecords,
        "sort": sort,
        "min_tech_score": min_tech_score,
        "query_count": len(TECH_QUERIES),
        "results": results,
        "analysis": build_analysis(results),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Cuba tech GDELT queries.")
    parser.add_argument("--timespan", default="180d", help='GDELT timespan (e.g. "24h", "7d", "180d").')
    parser.add_argument("--maxrecords", type=int, default=50, help="Max records per query.")
    parser.add_argument("--sort", default="date", choices=["date", "hybridrel"], help="GDELT sort mode.")
    parser.add_argument("--delay", type=float, default=MIN_SECONDS_BETWEEN_REQUESTS, help="Seconds between requests.")
    parser.add_argument("--min-tech-score", type=int, default=0, help="Minimum tech score required for each title.")
    parser.add_argument("--out", type=Path, default=None, help="Optional output JSON file path.")
    parser.add_argument("--analysis-only", action="store_true", help="Print only the analysis block.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = run_queries(
        timespan=args.timespan,
        maxrecords=args.maxrecords,
        sort=args.sort,
        delay_seconds=args.delay,
        min_tech_score=args.min_tech_score,
    )

    output_obj: Dict[str, Any] = payload["analysis"] if args.analysis_only else payload
    rendered = json.dumps(output_obj, ensure_ascii=False, indent=2)
    if args.out is not None:
        args.out.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
