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
    date, episode, title = parse_filename(mp3_name)
    full_title = os.path.splitext(mp3_name)[0]
    json_path = os.path.join(NOTES_DIR, full_title + ".json")

    transcription = transcribe_audio(mp3_path)

    if os.path.exists(json_path):
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data["content"] = transcription
    else:
        os.makedirs(NOTES_DIR, exist_ok=True)
        data = {
            "title": title,
            "uploadDate": date,
            "episode": episode,
            "fullTitle": full_title,
            "podcaster": "Gooaye",
            "content": transcription,
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
    date, episode, title = parse_filename(mp3_name)
    full_title = os.path.splitext(mp3_name)[0]

    console.print("[bold]步驟 1/4：轉錄...[/bold]")
    transcription = transcribe_audio(mp3_path)

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
        "note": summary,
        "themes": themes,
        "mentioned_stocks": mentioned_stocks,
        "stock_sentiments": stock_sentiments,
        "investment_thesis": investment_thesis,
        "market_sentiment": market_sentiment,
        "glossary_terms": glossary_terms,
    }
    # Upsert (force overwrite)
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
        "[bold cyan]🎙  Gooaye 音頻處理管線 TUI[/bold cyan]\n"
        "[dim]D=Downloaded  T=Transcribed  S=Summarized  E=Embedded  I=Indexed[/dim]",
        expand=False,
    ))

    if not os.path.isdir(PODCAST_DIR):
        console.print(f"[red]找不到 Podcast 目錄：{PODCAST_DIR}[/red]")
        sys.exit(1)

    mp3_files = sorted(
        [f for f in os.listdir(PODCAST_DIR) if f.endswith(".mp3")],
        reverse=True,  # newest first
    )
    if not mp3_files:
        console.print("[yellow]找不到任何 MP3 檔案。[/yellow]")
        sys.exit(0)

    valid_mp3s = [f for f in mp3_files if parse_filename(f)[0]]

    console.print(f"\n正在掃描 {len(valid_mp3s)} 個 MP3（ES 狀態檢查可能需要數秒）...\n")
    with console.status("建立狀態表格..."):
        table, statuses = build_table(valid_mp3s)

    console.print(table)

    # Build episode choices for questionary
    choices = []
    for mp3 in valid_mp3s:
        date, episode, title = parse_filename(mp3)
        st = statuses.get(mp3, {})
        flags = "".join([
            "D" if st.get("D") else "·",
            "T" if st.get("T") else "·",
            "S" if st.get("S") else "·",
            "E" if st.get("E") else "·",
            "I" if st.get("I") else "·",
        ])
        fmt_date = f"{date[:4]}-{date[4:6]}-{date[6:8]}" if date and len(date) == 8 else date
        label = f"EP{episode:>4}  {fmt_date}  {(title or '')[:38]:<38}  [{flags}]"
        choices.append(questionary.Choice(title=label, value=mp3))
    choices.append(questionary.Choice(title="── 離開 ──", value=None))

    selected_mp3 = questionary.select("\n選擇集數：", choices=choices).ask()
    if not selected_mp3:
        console.print("[dim]已離開。[/dim]")
        return

    date, episode, title = parse_filename(selected_mp3)
    mp3_path = os.path.join(PODCAST_DIR, selected_mp3)

    stage_choices = [
        questionary.Choice("全流程（轉錄 → 摘要 → 建立 chunks）", value="full"),
        questionary.Choice("僅轉錄 (Transcribe only)", value="transcribe"),
        questionary.Choice("僅摘要 + 豐富化 (Summarize only)", value="summarize"),
        questionary.Choice("僅重建 chunks + embeddings (Rebuild chunks only)", value="chunks"),
        questionary.Choice("── 取消 ──", value=None),
    ]

    selected_stage = questionary.select(
        f"\nEP{episode} {title} — 執行哪些階段？",
        choices=stage_choices,
    ).ask()

    if not selected_stage:
        console.print("[dim]已取消。[/dim]")
        return

    # Show cost estimate before confirming
    cost = estimate_cost(mp3_path, selected_stage)
    console.print(f"\n[yellow]預估 API 費用：{cost}[/yellow]")

    confirmed = questionary.confirm(
        f"確認對 EP{episode}《{title}》執行「{selected_stage}」？",
        default=False,
    ).ask()

    if not confirmed:
        console.print("[dim]已取消。[/dim]")
        return

    console.print(f"\n[bold]開始執行「{selected_stage}」...[/bold]\n")
    try:
        if selected_stage == "transcribe":
            run_transcribe(selected_mp3)
        elif selected_stage == "summarize":
            run_summarize(selected_mp3)
        elif selected_stage == "chunks":
            run_rebuild_chunks(selected_mp3)
        elif selected_stage == "full":
            run_full_pipeline(selected_mp3)
    except KeyboardInterrupt:
        console.print("\n[yellow]已中斷。[/yellow]")
        return
    except Exception as e:
        console.print(f"\n[red bold]✗ 執行失敗：{e}[/red bold]")
        return

    console.print("\n[green bold]完成！[/green bold]")

    if questionary.confirm("返回主畫面？", default=True).ask():
        main()


if __name__ == "__main__":
    main()
