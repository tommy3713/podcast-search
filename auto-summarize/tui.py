#!/usr/bin/env python3
"""
Gooaye 音頻處理管線 TUI 管理介面
Usage: python tui.py
"""
import os
import sys
import json

import questionary
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

MIN_MP3_BYTES = 100 * 1024  # 100 KB — anything smaller is likely a corrupted/failed download


def validate_mp3(mp3_path: str) -> None:
    """Raise ValueError if the MP3 file is missing or suspiciously small."""
    if not os.path.exists(mp3_path):
        raise ValueError(f"找不到 MP3 檔案：{mp3_path}")
    size = os.path.getsize(mp3_path)
    if size < MIN_MP3_BYTES:
        raise ValueError(
            f"MP3 檔案過小（{size} bytes），可能是下載失敗的殘檔。\n"
            f"建議刪除後重新下載：rm \"{mp3_path}\""
        )

from check_new import (
    load_rss_url,
    fetch_rss_episodes,
    get_local_episode_numbers,
    download_episode,
    fmt_date as rss_fmt_date,
    run_diff,
)

# Ensure imports from main.py work when run from anywhere
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import (
    PODCAST_DIR,
    NOTES_DIR,
    INDEX_NAME,
    parse_filename,
    transcribe_audio,
    summarize_transcription,
    classify_themes,
    extract_stocks,
    extract_investment_thesis,
    extract_sentiment_score,
    extract_glossary_terms,
    save_to_notes,
    index_chunks,
    elastic_client,
    ensure_podcast_mapping,
)

console = Console()


# ── Status detection ──────────────────────────────────────────────────────────

def check_es_indexed(full_title: str) -> bool:
    """Return True if fullTitle exists in the ES podcast index."""
    try:
        result = elastic_client.search(
            index=INDEX_NAME,
            body={"query": {"term": {"fullTitle": full_title}}, "size": 0},
        )
        return result["hits"]["total"]["value"] > 0
    except Exception:
        return False


def get_episode_status(mp3_name: str) -> dict:
    """Return {D, T, S, E, I} boolean flags for an episode."""
    full_title = os.path.splitext(mp3_name)[0]
    json_path = os.path.join(NOTES_DIR, full_title + ".json")

    D = True  # iterating from MP3 list, so always downloaded
    T = os.path.exists(json_path)
    S = E = False

    if T:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        S = bool(data.get("note", "").strip())
        E = "embeddings" in data

    I = check_es_indexed(full_title) if T else False

    return {"D": D, "T": T, "S": S, "E": E, "I": I}


# ── Cost estimation ───────────────────────────────────────────────────────────

def estimate_cost(mp3_path: str, stage: str) -> str:
    parts = []
    if stage in ("transcribe", "full"):
        try:
            size_bytes = os.path.getsize(mp3_path)
            est_mins = size_bytes / (128 * 1024 / 8) / 60
            parts.append(f"Whisper ~${est_mins * 0.006:.3f} (~{est_mins:.0f} min)")
        except OSError:
            parts.append("Whisper ~$?")
    if stage in ("summarize", "full"):
        parts.append("GPT-4o-mini summary ~$0.01–0.05")
    if stage in ("chunks", "full"):
        parts.append("Embeddings ~$0.005–0.02")
    return "、".join(parts) if parts else "無 API 費用"


# ── Pipeline stage actions ────────────────────────────────────────────────────

def run_transcribe(mp3_name: str) -> None:
    """Transcribe MP3 and write/update the content field in the JSON note."""
    mp3_path = os.path.join(PODCAST_DIR, mp3_name)
    validate_mp3(mp3_path)
    date, episode, title = parse_filename(mp3_name)
    full_title = os.path.splitext(mp3_name)[0]
    json_path = os.path.join(NOTES_DIR, full_title + ".json")

    transcription, segments = transcribe_audio(mp3_path)

    if os.path.exists(json_path):
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data["content"] = transcription
        data["segments"] = segments
    else:
        os.makedirs(NOTES_DIR, exist_ok=True)
        data = {
            "title": title,
            "uploadDate": date,
            "episode": episode,
            "fullTitle": full_title,
            "podcaster": "Gooaye",
            "content": transcription,
            "segments": segments,
            "note": "",
        }

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    console.print(f"[green]✓[/green] 轉錄已存至 {json_path}")


def run_summarize(mp3_name: str) -> None:
    """Summarize + enrich (themes, stocks, thesis, sentiment, glossary). Upserts ES podcast index."""
    full_title = os.path.splitext(mp3_name)[0]
    json_path = os.path.join(NOTES_DIR, full_title + ".json")

    if not os.path.exists(json_path):
        console.print("[red]✗ 找不到逐字稿 JSON，請先執行轉錄。[/red]")
        return

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    content = data.get("content", "").strip()
    if not content:
        console.print("[red]✗ JSON 內無逐字稿內容，請先執行轉錄。[/red]")
        return

    summary = summarize_transcription(content)
    themes = classify_themes(summary)
    mentioned_stocks, stock_sentiments = extract_stocks(summary)
    investment_thesis = extract_investment_thesis(summary)
    market_sentiment = extract_sentiment_score(summary)
    glossary_terms = extract_glossary_terms(summary)

    data.update({
        "note": summary,
        "themes": themes,
        "mentioned_stocks": mentioned_stocks,
        "stock_sentiments": stock_sentiments,
        "investment_thesis": investment_thesis,
        "market_sentiment": market_sentiment,
        "glossary_terms": glossary_terms,
    })

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

    # Upsert to podcast index (force overwrite by using id=full_title)
    doc = {k: v for k, v in data.items() if k != "embeddings"}
    ensure_podcast_mapping()
    elastic_client.index(index=INDEX_NAME, id=full_title, document=doc)
    console.print("[green]✓[/green] 摘要已完成並寫入 ES。")


def run_rebuild_chunks(mp3_name: str) -> None:
    """Delete existing podcast_chunks for this episode and rebuild from note text."""
    full_title = os.path.splitext(mp3_name)[0]
    json_path = os.path.join(NOTES_DIR, full_title + ".json")

    if not os.path.exists(json_path):
        console.print("[red]✗ 找不到 JSON，請先執行轉錄和摘要。[/red]")
        return

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    note_text = data.get("note", "").strip()
    if not note_text:
        console.print("[red]✗ JSON 內無摘要（note），請先執行摘要。[/red]")
        return

    episode = data.get("episode", "")
    upload_date = data.get("uploadDate", "")

    # Force-delete existing chunks then rebuild
    elastic_client.delete_by_query(
        index="podcast_chunks",
        body={"query": {"term": {"fullTitle": full_title}}},
    )
    embeddings = index_chunks(full_title, "Gooaye", episode, upload_date, note_text)

    data["embeddings"] = embeddings
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    console.print(f"[green]✓[/green] Chunks 已重建（{len(embeddings)} 個 chunks）。")


def run_full_pipeline(mp3_name: str) -> None:
    """Full pipeline: transcribe → summarize → upsert ES → rebuild chunks → save JSON."""
    mp3_path = os.path.join(PODCAST_DIR, mp3_name)
    validate_mp3(mp3_path)
    date, episode, title = parse_filename(mp3_name)
    full_title = os.path.splitext(mp3_name)[0]

    console.print("[bold]步驟 1/4：轉錄...[/bold]")
    transcription, segments = transcribe_audio(mp3_path)

    console.print("[bold]步驟 2/4：摘要 + 資料豐富化...[/bold]")
    summary = summarize_transcription(transcription)
    themes = classify_themes(summary)
    mentioned_stocks, stock_sentiments = extract_stocks(summary)
    investment_thesis = extract_investment_thesis(summary)
    market_sentiment = extract_sentiment_score(summary)
    glossary_terms = extract_glossary_terms(summary)

    console.print("[bold]步驟 3/4：寫入 ES podcast index...[/bold]")
    doc = {
        "podcaster": "Gooaye",
        "title": title,
        "uploadDate": date,
        "episode": episode,
        "fullTitle": full_title,
        "content": transcription,
        "segments": segments,
        "note": summary,
        "themes": themes,
        "mentioned_stocks": mentioned_stocks,
        "stock_sentiments": stock_sentiments,
        "investment_thesis": investment_thesis,
        "market_sentiment": market_sentiment,
        "glossary_terms": glossary_terms,
    }
    # Upsert (force overwrite)
    ensure_podcast_mapping()
    elastic_client.index(index=INDEX_NAME, id=full_title, document=doc)

    console.print("[bold]步驟 4/4：重建 chunks + embeddings...[/bold]")
    elastic_client.delete_by_query(
        index="podcast_chunks",
        body={"query": {"term": {"fullTitle": full_title}}},
    )
    embeddings = index_chunks(full_title, "Gooaye", episode, date, summary)

    save_to_notes(
        mp3_name, "Gooaye", title, episode, date, transcription, summary,
        embeddings=embeddings, themes=themes, mentioned_stocks=mentioned_stocks,
        stock_sentiments=stock_sentiments, investment_thesis=investment_thesis,
        market_sentiment=market_sentiment, glossary_terms=glossary_terms,
        segments=segments,
    )
    console.print(f"[green bold]✓ 全流程完成：{full_title}[/green bold]")


# ── Main TUI ──────────────────────────────────────────────────────────────────

def build_table(mp3_files: list) -> tuple:
    """Scan all MP3s, build rich status table and status dict."""
    table = Table(
        title="Gooaye 集數處理狀態",
        show_header=True,
        header_style="bold magenta",
    )
    table.add_column("#", style="dim", width=4)
    table.add_column("集數", style="cyan", width=6)
    table.add_column("日期", width=12)
    table.add_column("標題", no_wrap=False, max_width=38)
    table.add_column("D", width=3, justify="center")
    table.add_column("T", width=3, justify="center")
    table.add_column("S", width=3, justify="center")
    table.add_column("E", width=3, justify="center")
    table.add_column("I", width=3, justify="center")

    statuses: dict = {}
    for idx, mp3_name in enumerate(mp3_files, 1):
        date, episode, title = parse_filename(mp3_name)
        if not date:
            continue
        st = get_episode_status(mp3_name)
        statuses[mp3_name] = st

        def flag(v: bool) -> str:
            return "[green]✓[/green]" if v else "[dim]·[/dim]"

        fmt_date = f"{date[:4]}-{date[4:6]}-{date[6:8]}" if date and len(date) == 8 else date or "?"
        table.add_row(
            str(idx),
            episode or "?",
            fmt_date,
            title or mp3_name,
            flag(st["D"]),
            flag(st["T"]),
            flag(st["S"]),
            flag(st["E"]),
            flag(st["I"]),
        )

    return table, statuses


def main() -> None:
    console.clear()
    console.print(Panel(
        "[bold cyan]🎙  Gooaye 音頻處理管線 TUI[/bold cyan]",
        expand=False,
    ))

    try:
        with console.status("正在讀取 RSS feed..."):
            rss_url = load_rss_url()
            rss_episodes = fetch_rss_episodes(rss_url)
        local_eps = get_local_episode_numbers()
        unprocessed = [ep for ep in rss_episodes if ep["episode"] not in local_eps]
        unprocessed.sort(key=lambda x: x["pub_date"])

        console.print(
            f"RSS 共 [cyan]{len(rss_episodes)}[/cyan] 集  |  "
            f"本地已處理 [green]{len(local_eps)}[/green] 集  |  "
            f"未處理 [yellow]{len(unprocessed)}[/yellow] 集\n"
        )

        if not unprocessed:
            console.print("[green]✓ 所有集數已處理完畢！[/green]")
            return

        # Show table of unprocessed episodes
        rss_table = Table(show_header=True, header_style="bold magenta")
        rss_table.add_column("集數", style="cyan", width=6)
        rss_table.add_column("日期", width=12)
        rss_table.add_column("標題", no_wrap=False, max_width=50)
        for ep in unprocessed:
            rss_table.add_row(
                f"EP{ep['episode']}",
                rss_fmt_date(ep["pub_date"]),
                ep["title"],
            )
        console.print(rss_table)

        # Multi-select episodes to process
        ep_choices = [
            questionary.Choice(
                title=f"EP{ep['episode']:<6} {rss_fmt_date(ep['pub_date']):<12} {ep['title'][:50]}",
                value=ep,
            )
            for ep in unprocessed
        ]
        selected_eps = questionary.checkbox(
            "\n選擇要處理的集數（空白鍵選取，Enter 確認）：",
            choices=ep_choices,
        ).ask()

        if not selected_eps:
            console.print("[dim]已取消。[/dim]")
            return

        console.print(f"\n已選取 [cyan]{len(selected_eps)}[/cyan] 集，開始處理...\n")
        for ep in selected_eps:
            mp3_name = ep["full_title"] + ".mp3"
            mp3_path = os.path.join(PODCAST_DIR, mp3_name)

            # Download if not present or too small
            needs_download = (
                not os.path.exists(mp3_path)
                or os.path.getsize(mp3_path) < MIN_MP3_BYTES
            )
            if needs_download:
                console.print(f"[bold]↓  下載 EP{ep['episode']} {ep['title']}...[/bold]")
                try:
                    mp3_path = download_episode(ep, PODCAST_DIR)
                    mp3_name = os.path.basename(mp3_path)
                    console.print("[green]✓[/green] 下載完成")
                except Exception as e:
                    console.print(f"[red]✗ 下載失敗：{e}[/red]")
                    continue

            console.print(f"\n[bold]處理 EP{ep['episode']} {ep['title']}...[/bold]")
            try:
                run_full_pipeline(mp3_name)
            except Exception as e:
                console.print(f"[red bold]✗ 處理失敗：{e}[/red bold]")
                continue

        console.print("\n[green bold]全部完成！[/green bold]")

    except KeyboardInterrupt:
        console.print("\n[yellow]已中斷。[/yellow]")
        return
    except Exception as e:
        console.print(f"\n[red]✗ 錯誤：{e}[/red]")
        return

    if questionary.confirm("\n再次執行？", default=False).ask():
        main()


if __name__ == "__main__":
    main()
