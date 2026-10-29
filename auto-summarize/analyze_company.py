"""Cross-episode analysis for one company: analyzed-episode records, a price quote, then the run.

Every per-episode extraction is saved under analysis/<KEY>/extractions/ together
with the transcript hash, prompt hash and model it was made with, so a later
request only pays for episodes that were never analyzed or whose transcript or
prompt changed since. An episode with zero reasons is a valid record too.

Without --yes this only prints which episodes are already analyzed and what the
rest would cost. With --yes it extracts the missing episodes, re-runs thread
matching over the whole range, writes the matrix page, and publishes the result
to the `company_threads` ES index for the website's /analysis/<KEY> page.

Companies live in companies.json (key → prompt name + extra aliases).

Usage:
    python analyze_company.py NVDA --range 1y        # quote only
    python analyze_company.py NVDA --range all --yes # run
    python analyze_company.py NVDA --publish analysis/NVDA/threads_1y.json --range 1y  # re-publish a saved result
"""
import os
import sys
import json
import glob
import hashlib
import argparse
from datetime import date, datetime, timedelta

import tiktoken
from elasticsearch import Elasticsearch

import extract_reasons
import match_threads
import render_threads

HERE = os.path.dirname(__file__)
COMPANIES_FILE = os.path.join(HERE, "companies.json")
ANALYSIS_DIR = os.path.join(HERE, "analysis")
RANGES = {"6m": 183, "1y": 365, "all": None}
ES_INDEX = "company_threads"

# USD per 1M tokens (input, output). From third-party listings checked 2026-10-23,
# not OpenAI's own pricing page — confirm there before trusting the quote to the cent.
PRICES = {
    "gpt-5.5": (5.00, 30.00),
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
}
PRICES_CHECKED = "2026-10-23"

# Fallbacks until a company has its own records (measured on NVDA EP461–464, gpt-5.5)
DEFAULT_OUTPUT_TOKENS = 5500   # extraction output per episode, mostly reasoning tokens
DEFAULT_REASONS = 16           # reasons per episode
# Matching re-reads every thread for every reason, so its input grows with the
# square of the reason count: ~1300 tokens of prompt + ~60 per thread line, and
# about 0.28 new threads per reason.
MATCH_BASE_TOKENS = 1300
MATCH_TOKENS_PER_THREAD = 60
THREADS_PER_REASON = 0.28
MATCH_OUTPUT_TOKENS = 335

_enc = tiktoken.get_encoding("o200k_base")


def load_company(key):
    with open(COMPANIES_FILE, "r", encoding="utf-8") as f:
        companies = json.load(f)
    if key not in companies:
        sys.exit(f"{key} is not in companies.json (known: {', '.join(companies)}). Add its name and aliases first.")
    c = companies[key]
    return c["company"], extract_reasons.company_aliases(c["company"], c.get("aliases"))


def load_notes():
    notes = []
    for path in glob.glob(os.path.join(extract_reasons.NOTES_DIR, "*.json")):
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if data.get("content") and data.get("uploadDate"):
            notes.append(data)
    return sorted(notes, key=lambda d: d["uploadDate"])


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def record_path(key, episode):
    return os.path.join(ANALYSIS_DIR, key, "extractions", f"{episode}.json")


def load_record(key, episode):
    path = record_path(key, episode)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_record(key, data, result, prompt_sha):
    result = dict(result)
    result["record"] = {
        "transcript_sha": sha(data["content"]),
        "prompt_sha": prompt_sha,
        "model": result["model"],
        "analyzed_at": datetime.now().isoformat(timespec="seconds"),
    }
    path = record_path(key, result["episode"])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)


def status(record, data, prompt_sha, model):
    if record is None:
        return "new"
    meta = record.get("record", {})
    if meta.get("transcript_sha") != sha(data["content"]):
        return "transcript_changed"
    if meta.get("prompt_sha") != prompt_sha or meta.get("model") != model:
        return "prompt_changed"
    return "cached"


def episode_ranges(episodes, all_eps, mentioned):
    """Compress episode ids into runs, e.g. 'EP461–EP464、EP500'.

    `all_eps` is every note in upload order. A note that never names the company
    doesn't break a run (there was nothing to analyze), but a mentioning episode
    outside `episodes` or a missing episode number does.
    """
    runs, cur, prev = [], [], None
    for e in all_eps:
        num = int(e[2:])
        if prev is not None and num != prev + 1 and cur:
            runs.append(cur)
            cur = []
        prev = num
        if e in episodes:
            cur.append(e)
        elif e in mentioned and cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return "、".join(r[0] if len(r) == 1 else f"{r[0]}–{r[-1]}" for r in runs)


def avg_from_records(records, field):
    values = [field(r) for r in records]
    return sum(values) / len(values) if values else None


def quote(company, model, to_run, cached_records, notes_by_ep):
    """Return (extract_usd, match_usd, details) for running `to_run` and re-matching the whole range."""
    price_in, price_out = PRICES[model]
    match_in_price, match_out_price = PRICES[match_threads.MODEL]
    system = extract_reasons.SYSTEM_PROMPT.format(company=company)
    input_tokens = sum(len(_enc.encode(system + notes_by_ep[e]["content"])) + 20 for e in to_run)

    same_model = [r for r in cached_records if r.get("model") == model]
    out_per_ep = avg_from_records(same_model, lambda r: r["usage"]["completion_tokens"]) or DEFAULT_OUTPUT_TOKENS
    reasons_per_ep = avg_from_records(cached_records, lambda r: len(r["reasons"])) or DEFAULT_REASONS
    extract_usd = (input_tokens * price_in + len(to_run) * out_per_ep * price_out) / 1e6

    n = sum(len(r["reasons"]) for r in cached_records) + len(to_run) * reasons_per_ep
    match_in = n * MATCH_BASE_TOKENS + MATCH_TOKENS_PER_THREAD * THREADS_PER_REASON * n * n / 2
    match_usd = (match_in * match_in_price + n * MATCH_OUTPUT_TOKENS * match_out_price) / 1e6
    return extract_usd, match_usd, {"input_tokens": input_tokens, "out_per_ep": out_per_ep, "reasons": n}


def publish(key, range_label, matched):
    """Write one doc per company to ES; the latest analysis replaces the previous one."""
    es = Elasticsearch(
        [os.getenv("ELASTICSEARCH_HOST")],
        basic_auth=(os.getenv("ELASTICSEARCH_USERNAME"), os.getenv("ELASTICSEARCH_PASSWORD")),
    )
    if not es.indices.exists(index=ES_INDEX):
        es.indices.create(index=ES_INDEX, mappings={
            "properties": {
                "key": {"type": "keyword"},
                "company": {"type": "keyword"},
                "range": {"type": "keyword"},
                "generated_at": {"type": "date"},
                "episode_count": {"type": "integer"},
                "thread_count": {"type": "integer"},
                "reason_count": {"type": "integer"},
                "first_episode": {"type": "keyword"},
                "last_episode": {"type": "keyword"},
                "first_date": {"type": "keyword"},
                "last_date": {"type": "keyword"},
                # Read back whole by the backend, never queried
                "episodes": {"type": "object", "enabled": False},
                "threads": {"type": "object", "enabled": False},
            }
        })
    episodes = matched["episodes"]
    es.index(index=ES_INDEX, id=key, document={
        "key": key,
        "company": matched["company"],
        "range": range_label,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "episode_count": len(episodes),
        "thread_count": len(matched["threads"]),
        "reason_count": sum(len(t["history"]) for t in matched["threads"]),
        "first_episode": episodes[0]["episode"] if episodes else None,
        "last_episode": episodes[-1]["episode"] if episodes else None,
        "first_date": episodes[0]["date"] if episodes else None,
        "last_date": episodes[-1]["date"] if episodes else None,
        "episodes": episodes,
        "threads": matched["threads"],
    })
    print(f"已發布到 ES（{ES_INDEX}/{key}），網站：/analysis/{key}")


def main():
    parser = argparse.ArgumentParser(description="Quote, then run, a cross-episode analysis for one company.")
    parser.add_argument("key", help="Company key in companies.json, e.g. NVDA")
    parser.add_argument("--range", choices=RANGES, default="1y", help="Episodes uploaded in the last 6 months, year, or all")
    parser.add_argument("--model", default=extract_reasons.MODEL)
    parser.add_argument("--yes", action="store_true", help="Run after quoting (default: quote only)")
    parser.add_argument("--publish", metavar="THREADS_JSON", help="Only publish an existing match result to ES, then exit")
    args = parser.parse_args()
    if args.publish:
        load_company(args.key)
        with open(args.publish, "r", encoding="utf-8") as f:
            publish(args.key, args.range, json.load(f))
        return
    for m in (args.model, match_threads.MODEL):
        if m not in PRICES:
            sys.exit(f"No price for {m}; add it to PRICES first.")

    company, aliases = load_company(args.key)
    alias_re = extract_reasons.alias_pattern(aliases)
    prompt_sha = sha(extract_reasons.SYSTEM_PROMPT.format(company=company))

    all_notes = load_notes()
    all_eps = [f"EP{d['episode']}" for d in all_notes]
    notes = all_notes
    days = RANGES[args.range]
    if days:
        since = (date.today() - timedelta(days=days)).strftime("%Y%m%d")
        notes = [d for d in notes if d["uploadDate"] >= since]
    in_range = [d for d in notes if extract_reasons.mentions(alias_re, d["content"])]
    notes_by_ep = {f"EP{d['episode']}": d for d in in_range}
    order = list(notes_by_ep)

    groups = {"cached": [], "new": [], "transcript_changed": [], "prompt_changed": []}
    records = {}
    for ep, data in notes_by_ep.items():
        records[ep] = load_record(args.key, ep)
        groups[status(records[ep], data, prompt_sha, args.model)].append(ep)
    to_run = groups["new"] + groups["transcript_changed"] + groups["prompt_changed"]
    cached_records = [records[e] for e in groups["cached"]]

    first, last = (notes[0], notes[-1]) if notes else (None, None)
    span = f"{first['uploadDate']}–{last['uploadDate']}" if notes else "（沒有集數）"
    print(f"{company} · {args.range} · {span}")
    print(f"範圍內 {len(notes)} 集，其中 {len(in_range)} 集提到（別名：{'/'.join(aliases)}）")
    labels = {
        "cached": "已分析（沿用）",
        "new": "沒分析過",
        "transcript_changed": "逐字稿已更新，要重跑",
        "prompt_changed": "prompt 或模型已變更，要重跑",
    }
    for g, label in labels.items():
        if groups[g]:
            print(f"  {label}：{len(groups[g])} 集  {episode_ranges(set(groups[g]), all_eps, set(order))}")

    stored = sorted(os.path.basename(p)[:-5] for p in glob.glob(record_path(args.key, "*")))
    outside = [e for e in stored if e not in notes_by_ep]
    if outside:
        print(f"  （範圍外另有 {len(outside)} 集已分析的紀錄：{episode_ranges(set(outside), all_eps, set(outside))}）")

    extract_usd, match_usd, d = quote(company, args.model, to_run, cached_records, notes_by_ep)
    print(f"\n報價（單價為每 1M token 的 input/output，{PRICES_CHECKED} 查詢）")
    print(f"  抽取 {len(to_run)} 集（{args.model}，${PRICES[args.model][0]}/${PRICES[args.model][1]}）：約 ${extract_usd:.2f}"
          f"（輸入 {d['input_tokens']:,} token，輸出約 {d['out_per_ep']:,.0f} token/集）")
    print(f"  歸主題 約 {d['reasons']:.0f} 條理由（{match_threads.MODEL}，${PRICES[match_threads.MODEL][0]}/${PRICES[match_threads.MODEL][1]}）"
          f"：約 ${match_usd:.2f}（目前每次整個範圍重跑，不沿用）")
    print(f"  合計約 ${extract_usd + match_usd:.2f}")

    if not args.yes:
        print("\n只報價，沒有執行。確認後加上 --yes 執行。")
        return

    failed = []
    for ep in to_run:
        result = extract_reasons.extract_episode(notes_by_ep[ep], company, args.model, aliases=aliases)
        if result["failed_windows"]:
            # Don't record it: a failed call would otherwise look like "analyzed, no reasons" forever
            failed.append(ep)
            continue
        save_record(args.key, notes_by_ep[ep], result, prompt_sha)
        records[ep] = load_record(args.key, ep)
    if failed:
        print(f"抽取失敗、沒有存紀錄（下次會再跑）：{', '.join(failed)}", file=sys.stderr)

    results = [records[e] for e in order if e not in failed]
    matched = match_threads.match(company, results)
    out_base = os.path.join(ANALYSIS_DIR, args.key, f"threads_{args.range}")
    with open(out_base + ".json", "w", encoding="utf-8") as f:
        json.dump(matched, f, ensure_ascii=False, indent=2)
    with open(out_base + ".html", "w", encoding="utf-8") as f:
        f.write(render_threads.render(matched))
    publish(args.key, args.range, matched)

    spent = sum(
        (u["prompt_tokens"] * PRICES[m][0] + u["completion_tokens"] * PRICES[m][1]) / 1e6
        for u, m in ((extract_reasons.usage, args.model), (matched["usage"], match_threads.MODEL))
    )
    print(f"完成：實際花費約 ${spent:.2f}")
    print(out_base + ".html")


if __name__ == "__main__":
    main()
