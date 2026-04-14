#!/usr/bin/env python3
"""
RSS vs. 本地 diff 工具 — 偵測尚未處理的集數

Usage:
    python check_new.py              # 列出未處理集數
    python check_new.py --download   # 列出後詢問是否下載

比對邏輯：以集數編號（EP461）為 key，RSS 有而本地 notes/gooaye/ 無 JSON 的即為未處理。
"""
import os
import sys
import re
import json
import argparse
import subprocess
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(_DIR, "config.json")
NOTES_DIR = os.path.join(_DIR, "..", "notes", "gooaye")


def load_rss_url() -> str:
    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        config = json.load(f)
    return config["podcasts"][0]["rss_link"]


def parse_pub_date(pub_date_str: str) -> str:
    """Convert RFC 2822 pubDate → YYYYMMDD string. Returns '' on failure."""
    try:
        dt = parsedate_to_datetime(pub_date_str.strip())
        return dt.strftime("%Y%m%d")
    except Exception:
        return ""


def fetch_rss_episodes(url: str) -> list[dict]:
    """
    Fetch RSS and return list of dicts:
      {episode, title, pub_date, full_title}
    Only items whose title contains EPxxx are included.
    """
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; podcast-rss-checker/1.0)"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        tree = ET.parse(resp)

    items = []
    for item in tree.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        pub_date = parse_pub_date(item.findtext("pubDate") or "")

        m = re.search(r"EP(\d+)", title, re.IGNORECASE)
        if not m:
            continue

        episode = m.group(1)
        full_title = f"[{pub_date}] {title}" if pub_date else title

        items.append({
            "episode": episode,
            "title": title,
            "pub_date": pub_date,
            "full_title": full_title,
        })

    return items


def get_local_episode_numbers() -> set[str]:
    """Return set of episode numbers present in notes/gooaye/ as JSONs."""
    if not os.path.isdir(NOTES_DIR):
        return set()
    result = set()
    for fname in os.listdir(NOTES_DIR):
        if not fname.endswith(".json"):
            continue
        m = re.search(r"EP(\d+)", fname, re.IGNORECASE)
        if m:
            result.add(m.group(1))
    return result


def fmt_date(d: str) -> str:
    if len(d) == 8:
        return f"{d[:4]}-{d[4:6]}-{d[6:8]}"
    return d


def run_diff(download: bool = False) -> list[dict]:
    """
    Core logic — also usable from tui.py.
    Prints results and returns the unprocessed episode list.
    """
    print("正在讀取 RSS feed...")
    try:
        rss_url = load_rss_url()
        rss_episodes = fetch_rss_episodes(rss_url)
    except Exception as e:
        print(f"✗ 無法讀取 RSS：{e}")
        return []

    local_episodes = get_local_episode_numbers()

    total_rss = len(rss_episodes)
    total_local = len(local_episodes)

    unprocessed = [
        ep for ep in rss_episodes
        if ep["episode"] not in local_episodes
    ]
    unprocessed.sort(key=lambda x: x["pub_date"])

    print(f"RSS 共 {total_rss} 集  |  本地已處理 {total_local} 集  |  未處理 {len(unprocessed)} 集\n")

    if not unprocessed:
        print("✓ 所有集數已處理完畢！")
        return []

    col_ep = max(len("集數"), max(len(f"EP{e['episode']}") for e in unprocessed))
    col_date = 12

    header = f"{'集數':<{col_ep}}  {'日期':<{col_date}}  標題"
    print(header)
    print("-" * (col_ep + col_date + 40))
    for ep in unprocessed:
        print(f"EP{ep['episode']:<{col_ep - 2}}  {fmt_date(ep['pub_date']):<{col_date}}  {ep['title']}")

    if download:
        print()
        ans = input("是否下載未處理集數？(y/N) ").strip().lower()
        if ans == "y":
            print("\n啟動 podcast_downloader...")
            subprocess.run(
                [sys.executable, "-m", "podcast_downloader", "--config", CONFIG_FILE],
                check=True,
            )
            print("下載完成。")

    return unprocessed


def main():
    parser = argparse.ArgumentParser(
        description="比對 RSS feed 與本地 JSON，輸出尚未處理的集數。"
    )
    parser.add_argument(
        "--download",
        action="store_true",
        help="列出後詢問是否觸發 podcast_downloader 下載",
    )
    args = parser.parse_args()
    run_diff(download=args.download)


if __name__ == "__main__":
    main()
