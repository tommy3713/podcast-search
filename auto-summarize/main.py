import os
import sys
import re
import subprocess
import textwrap
import mlx_whisper
from openai import OpenAI
import json
from elasticsearch import Elasticsearch
from datetime import datetime
from dotenv import load_dotenv
load_dotenv()

# OpenAI API Configuration
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
# Elasticsearch Configuration
ELASTICSEARCH_HOST = os.getenv("ELASTICSEARCH_HOST")
ELASTICSEARCH_USERNAME = os.getenv("ELASTICSEARCH_USERNAME")
ELASTICSEARCH_PASSWORD = os.getenv("ELASTICSEARCH_PASSWORD")
INDEX_NAME = "podcast"

THEMES = [
    "美股與科技股",
    "台灣市場",
    "總體經濟",
    "中國與新興市場",
    "投資心理與哲學",
    "能源與原物料",
    "債券與利率",
    "加密貨幣",
    "房地產",
]

# Directories
PODCAST_DIR = "../podcasts/gooaye"
NOTES_DIR = "../notes/gooaye"
CONFIG_FILE = "./config.json"

CHUNK_TARGET = 600  # target chars per text chunk

# Initialize OpenAI Client
openai_client = OpenAI(api_key=OPENAI_API_KEY)
# Initialize Elasticsearch Client
elastic_client = Elasticsearch(
    [ELASTICSEARCH_HOST],
    basic_auth=(ELASTICSEARCH_USERNAME, ELASTICSEARCH_PASSWORD)
)


# Function: Download Podcasts
def download_podcasts():
    print("Downloading latest podcasts...")
    subprocess.run(
        [sys.executable, "-m", "podcast_downloader", "--config", CONFIG_FILE],
        check=True
    )
    print("Podcasts downloaded.")


# Proper nouns hint for Whisper — add any terms that get consistently misheard
WHISPER_PROMPT = "股癌，謝孟恭，Gooaye，台股，美股，Fed，聯準會，ETF，殖利率，通膨，升息，降息，半導體，台積電，輝達，NVIDIA，蘋果，Google，Meta，特斯拉，股海，SiFive"

# Known Whisper transcription errors — add new ones as they're discovered
TRANSCRIPTION_FIXES = {
    "聖風宮": "謝孟恭",
    "謝夢恭": "謝孟恭",
    "谷海": "股癌",
    "孫悟空": "謝孟恭",
}

def fix_transcription(text):
    for wrong, correct in TRANSCRIPTION_FIXES.items():
        text = text.replace(wrong, correct)
    return text

# Function: Transcribe audio using mlx-whisper (local, Apple Silicon)
def transcribe_audio(file_path):
    print(f"Transcribing {os.path.basename(file_path)}...")
    result = mlx_whisper.transcribe(
        file_path,
        path_or_hf_repo="mlx-community/whisper-large-v3-turbo",
        language="zh",
        initial_prompt=WHISPER_PROMPT,
    )
    print("Transcription completed.")
    return fix_transcription(result["text"])


MAX_TRANSCRIPTION_CHARS = 120000  # ~60k tokens for Chinese text, safely under gpt-4o-mini's 128k limit

# Function: Summarize transcription using OpenAI GPT
def summarize_transcription(transcription_text):
    print("Summarizing transcription...")

    if len(transcription_text) > MAX_TRANSCRIPTION_CHARS:
        truncated = transcription_text[:MAX_TRANSCRIPTION_CHARS]
        last_period = max(truncated.rfind('。'), truncated.rfind('！'), truncated.rfind('？'))
        if last_period > 0:
            truncated = truncated[:last_period + 1]
        print(f"  Transcription truncated from {len(transcription_text)} to {len(truncated)} chars.")
    else:
        truncated = transcription_text

    for attempt in range(1, 4):
        try:
            response = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "你是文字編輯，專門從 podcast 逐字稿中提取每段最具價值的內容。"},
                    {"role": "user", "content": textwrap.dedent(f"""\
                        以下是 podcast 的逐字稿內容，請幫我用繁體中文整理成以下格式：
                        章節劃分與主題整理：
                        - 若逐字稿可辨識章節，請劃分為例如「節目開場」、「生活雜談」、「市場觀察」、「聽眾回覆」等章節。
                        - 每章節可用 1～5 個 bullet points 表達，每點內容請直接照抄原文，不用改寫，並務必具備主題、主持人觀點、具體例子、情緒或故事脈絡。
                        - 每個章節同時請穿插最多五則精選主持人金句，將其置於對應的章節內。這些金句應具備語言風格鮮明、有啟發性或情緒張力，或能代表該集核心觀點。
                        -「聽眾回覆」列出所有聽眾留言（可直接照抄原文），並在每則下方附上主持人回覆（可直接照抄原文）
                        - 每點需涵蓋：主題、主持人的具體觀點或判斷、佐證例子或數據（若有）
                        請避免產出空泛套話（如「值得參考」、「令人感動」），並重視內容密度與完整性。
                        最後，整理主持人在這集中提到的股票、標的或公司，並列出他說了什麼觀點。
                        逐字稿內容如下：
                        {truncated}
                    """)}
                ]
            )
            summary = response.choices[0].message.content
            print("Summarization completed.")
            return summary
        except Exception as e:
            print(f"  Summarization attempt {attempt}/3 failed: {e}")
            if attempt == 3:
                raise RuntimeError(f"Summarization failed after 3 attempts: {e}")


def extract_sentiment_score(note_text):
    """Extract overall market sentiment score from episode note via GPT-4o-mini.
    Returns dict with score (float -1 to 1), label (str), reason (str).
    """
    empty = {"score": 0, "label": "謹慎", "reason": ""}
    valid_labels = {"樂觀", "謹慎", "悲觀"}
    for attempt in range(1, 4):
        try:
            response = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": "你是財經分析助手，根據 podcast 摘要判斷主持人對整體市場的情緒。"},
                    {"role": "user", "content": (
                        f"摘要內容：\n{note_text[:4000]}\n\n"
                        "請輸出 JSON 格式：\n"
                        "{\"sentiment_score\": 0.6, \"sentiment_label\": \"樂觀\", \"sentiment_reason\": \"主持人認為...\"}\n"
                        "sentiment_score 為 -1.0（極度悲觀）到 1.0（極度樂觀）之間的浮點數，0 為中性。\n"
                        "sentiment_label 只能是「樂觀」、「謹慎」、「悲觀」之一。\n"
                        "sentiment_reason 為 1-2 句繁體中文說明。"
                    )},
                ]
            )
            result = json.loads(response.choices[0].message.content)
            score = result.get("sentiment_score", 0)
            label = result.get("sentiment_label", "謹慎")
            reason = result.get("sentiment_reason", "")
            # Validate
            if not isinstance(score, (int, float)) or not (-1 <= score <= 1):
                raise ValueError(f"Invalid sentiment_score: {score}")
            if label not in valid_labels:
                raise ValueError(f"Invalid sentiment_label: {label}")
            if not isinstance(reason, str):
                reason = ""
            sentiment = {"score": float(score), "label": label, "reason": reason}
            print(f"  Market sentiment: {label} ({score:.2f})")
            return sentiment
        except Exception as e:
            print(f"  Sentiment extraction attempt {attempt}/3 failed: {e}")
            if attempt == 3:
                return empty


def extract_investment_thesis(note_text):
    """Extract structured investment thesis from episode note via GPT-4o-mini.
    Returns dict with bullish, bearish (lists of {stock, reason}) and macro_view (str).
    """
    empty = {"bullish": [], "bearish": [], "macro_view": ""}
    for attempt in range(1, 4):
        try:
            response = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": "你是財經分析助手，從 podcast 摘要中萃取主持人的核心投資論點。"},
                    {"role": "user", "content": (
                        f"摘要內容：\n{note_text[:4000]}\n\n"
                        "請輸出 JSON 格式：\n"
                        "{\"bullish\": [{\"stock\": \"NVDA\", \"reason\": \"AI 需求強勁\"}], "
                        "\"bearish\": [{\"stock\": \"AAPL\", \"reason\": \"中國市場萎縮\"}], "
                        "\"macro_view\": \"Fed 暫停升息，市場偏多頭\"}\n"
                        "若無明確論點，回傳 {\"bullish\": [], \"bearish\": [], \"macro_view\": \"\"}。"
                    )},
                ]
            )
            result = json.loads(response.choices[0].message.content)
            bullish = [
                {"stock": str(i["stock"]), "reason": str(i["reason"])}
                for i in result.get("bullish", [])
                if isinstance(i.get("stock"), str) and isinstance(i.get("reason"), str)
            ]
            bearish = [
                {"stock": str(i["stock"]), "reason": str(i["reason"])}
                for i in result.get("bearish", [])
                if isinstance(i.get("stock"), str) and isinstance(i.get("reason"), str)
            ]
            macro_view = result.get("macro_view", "")
            if not isinstance(macro_view, str):
                macro_view = ""
            thesis = {"bullish": bullish, "bearish": bearish, "macro_view": macro_view}
            print(f"  Investment thesis: {len(bullish)} bullish, {len(bearish)} bearish, macro={'yes' if macro_view else 'no'}")
            return thesis
        except Exception as e:
            print(f"  Investment thesis extraction attempt {attempt}/3 failed: {e}")
            if attempt == 3:
                return empty


# Function: Save final result to notes/gooaye/ in the project's standard JSON format
def save_to_notes(file_name, podcaster, title, episode, upload_date, content, note, embeddings=None, themes=None, mentioned_stocks=None, stock_sentiments=None, investment_thesis=None, market_sentiment=None):
    os.makedirs(NOTES_DIR, exist_ok=True)
    note_name = os.path.splitext(file_name)[0]  # strip .mp3
    note_path = os.path.join(NOTES_DIR, f"{note_name}.json")
    data = {
        "title": title,
        "uploadDate": upload_date,
        "episode": episode,
        "fullTitle": note_name,
        "podcaster": podcaster,
        "content": content,
        "note": note,
    }
    if embeddings is not None:
        data["embeddings"] = embeddings
    if themes is not None:
        data["themes"] = themes
    if mentioned_stocks is not None:
        data["mentioned_stocks"] = mentioned_stocks
    if stock_sentiments is not None:
        data["stock_sentiments"] = stock_sentiments
    if investment_thesis is not None:
        data["investment_thesis"] = investment_thesis
    if market_sentiment is not None:
        data["market_sentiment"] = market_sentiment
    with open(note_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    print(f"Saved note to {note_path}")


def classify_themes(note_text):
    """Classify episode themes using GPT-4o-mini. Returns list from the 9 defined themes."""
    themes_list = "、".join(THEMES)
    for attempt in range(1, 4):
        try:
            response = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": "你是一個分類助手，請根據以下 podcast 摘要，從給定的主題清單中選出最相關的主題（可多選，至少一個）。"},
                    {"role": "user", "content": f"主題清單：{themes_list}\n\n摘要內容：\n{note_text[:4000]}\n\n請輸出 JSON 格式：{{\"themes\": [\"主題1\", \"主題2\"]}}，只能從清單中選取。"},
                ]
            )
            result = json.loads(response.choices[0].message.content)
            themes = [t for t in result.get("themes", []) if t in THEMES]
            print(f"  Themes: {themes}")
            return themes if themes else [THEMES[0]]
        except Exception as e:
            print(f"  Theme classification attempt {attempt}/3 failed: {e}")
            if attempt == 3:
                return []


def extract_stocks(note_text):
    """Extract mentioned stocks with sentiment from episode note via GPT-4o-mini.
    Returns (tickers: list[str], sentiments: list[dict]).
    """
    for attempt in range(1, 4):
        try:
            response = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": (
                        "你是財經助手，從 podcast 摘要中抽出所有被明確提及的股票。"
                        "情緒限定：bullish（看多）、bearish（看空）、neutral（中性/僅提及）。"
                        "台股用數字代號（如 2330、0050），美股用英文代號（如 NVDA、AAPL）。"
                        "若無股票提及，回傳空陣列。"
                    )},
                    {"role": "user", "content": (
                        f"摘要內容：\n{note_text[:4000]}\n\n"
                        "輸出 JSON 格式：{\"stocks\": [{\"ticker\": \"NVDA\", \"sentiment\": \"bullish\"}]}"
                    )},
                ]
            )
            result = json.loads(response.choices[0].message.content)
            stocks = result.get("stocks", [])
            # Validate shape
            valid = [s for s in stocks if isinstance(s.get("ticker"), str) and s.get("sentiment") in ("bullish", "bearish", "neutral")]
            tickers = [s["ticker"].upper() for s in valid]
            sentiments = [{"ticker": s["ticker"].upper(), "sentiment": s["sentiment"]} for s in valid]
            print(f"  Stocks: {tickers}")
            return tickers, sentiments
        except Exception as e:
            print(f"  Stock extraction attempt {attempt}/3 failed: {e}")
            if attempt == 3:
                return [], []


MAX_CHUNK_CHARS = 1500  # hard cap — well under 8192 tokens for Chinese text

# Function: Chunk text by sentence boundaries (。！？) with one-sentence overlap.
# Falls back to hard character split if a sentence exceeds MAX_CHUNK_CHARS.
def chunk_text_by_sentence(text, target_size=CHUNK_TARGET):
    sentences = re.split(r'(?<=[。！？])', text)
    sentences = [s.strip() for s in sentences if s.strip()]

    chunks = []
    current = []
    current_len = 0

    for sent in sentences:
        # If a single sentence is too long, hard-split it first
        if len(sent) > MAX_CHUNK_CHARS:
            if current:
                chunks.append("".join(current))
                current, current_len = [], 0
            for i in range(0, len(sent), CHUNK_TARGET):
                chunks.append(sent[i:i + CHUNK_TARGET])
            continue

        if current_len + len(sent) > target_size and current:
            chunks.append("".join(current))
            current = [current[-1], sent]
            current_len = sum(len(s) for s in current)
        else:
            current.append(sent)
            current_len += len(sent)

    if current:
        chunks.append("".join(current))

    return chunks


def embed_text(text):
    response = openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=text,
    )
    return response.data[0].embedding


def index_chunks(file_name, podcaster, episode, upload_date, text):
    chunks = chunk_text_by_sentence(text)
    print(f"  Indexing {len(chunks)} chunks for {file_name}...")
    embeddings = []
    for i, chunk in enumerate(chunks):
        embedding = embed_text(chunk)
        embeddings.append(embedding)
        elastic_client.index(index="podcast_chunks", document={
            "fullTitle": file_name,
            "podcaster": podcaster,
            "episode": episode,
            "uploadDate": upload_date,
            "chunk_index": i,
            "content": chunk,
            "embedding": embedding,
        })
    return embeddings


# Function: Index transcription in Elasticsearch
def index_transcription(file_name, podcaster, title, episode, full_transcription_text, uploadDate, note=None, themes=None, mentioned_stocks=None, stock_sentiments=None, investment_thesis=None, market_sentiment=None):
    document = {
        'podcaster': podcaster,
        'title': title,
        'uploadDate': uploadDate,
        'episode': episode,
        'fullTitle': file_name,
        'content': full_transcription_text,
    }
    if note:
        document['note'] = note
    if themes:
        document['themes'] = themes
    if mentioned_stocks:
        document['mentioned_stocks'] = mentioned_stocks
    if stock_sentiments:
        document['stock_sentiments'] = stock_sentiments
    if investment_thesis is not None:
        document['investment_thesis'] = investment_thesis
    if market_sentiment is not None:
        document['market_sentiment'] = market_sentiment
    response = elastic_client.index(index=INDEX_NAME, document=document)
    print(f"Document indexed in Elasticsearch: {response}")


# Function: Check if episode is already processed by looking for its JSON in notes/
def is_already_processed(file_name):
    note_name = os.path.splitext(file_name)[0]
    return os.path.exists(os.path.join(NOTES_DIR, f"{note_name}.json"))



def parse_filename(file_name):
    pattern = r"\[(\d{8})\]\s*EP(\d+)\s*(.*?)\.mp3$"
    match = re.match(pattern, file_name)
    if match:
        return match.group(1), match.group(2), match.group(3).strip()
    return None, None, None


# Function: Process for testing (first file only, short transcription)
def test_process():
    download_podcasts()
    for file_name in sorted(os.listdir(PODCAST_DIR), reverse=True):
        if not file_name.endswith(".mp3"):
            continue

        print(f"Found podcast file: {file_name}")
        if is_already_processed(file_name):
            print(f"Already in database: {file_name}")
            return

        date, episode, title = parse_filename(file_name)
        print(f"Date: {date}, Episode: {episode}, Title: {title}")

        file_path = os.path.join(PODCAST_DIR, file_name)

        # Transcribe locally with mlx-whisper
        full_transcription_text = transcribe_audio(file_path)

        # Summarize
        summary = summarize_transcription(full_transcription_text)

        # Classify themes + extract stocks + extract investment thesis + sentiment (enrichment after summary)
        themes = classify_themes(summary)
        mentioned_stocks, stock_sentiments = extract_stocks(summary)
        investment_thesis = extract_investment_thesis(summary)
        market_sentiment = extract_sentiment_score(summary)

        # Index in ES
        index_transcription(file_name, "Gooaye", title, episode, full_transcription_text, date, note=summary, themes=themes, mentioned_stocks=mentioned_stocks, stock_sentiments=stock_sentiments, investment_thesis=investment_thesis, market_sentiment=market_sentiment)
        embeddings = index_chunks(file_name, "Gooaye", episode, date, summary)

        # Save to notes/gooaye/ (with embeddings cached)
        save_to_notes(file_name, "Gooaye", title, episode, date, full_transcription_text, summary, embeddings=embeddings, themes=themes, mentioned_stocks=mentioned_stocks, stock_sentiments=stock_sentiments, investment_thesis=investment_thesis, market_sentiment=market_sentiment)

        break  # Process only the first file for testing



# Function: Index all notes from notes/gooaye/ into ES (upsert by fullTitle).
# Chunks are built from the `note` (GPT summary) field, not the raw transcript.
# Always deletes and rebuilds podcast_chunks to ensure they reflect the latest note content.
def reindex_from_notes():
    notes = sorted(os.listdir(NOTES_DIR))
    print(f"Found {len(notes)} notes to index.")
    for note_file in notes:
        if not note_file.endswith(".json"):
            continue
        note_path = os.path.join(NOTES_DIR, note_file)
        with open(note_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        full_title = data.get("fullTitle", "")
        note_text = data.get("note", "")
        episode = data.get("episode", "")
        upload_date = data.get("uploadDate", "")

        print(f"Indexing {full_title}...")

        # Backfill themes if missing
        if "themes" not in data and note_text:
            print(f"  Classifying themes for {full_title}...")
            data["themes"] = classify_themes(note_text)

        # Backfill stocks if missing
        if "mentioned_stocks" not in data and note_text:
            print(f"  Extracting stocks for {full_title}...")
            data["mentioned_stocks"], data["stock_sentiments"] = extract_stocks(note_text)

        # Backfill investment_thesis if missing
        if "investment_thesis" not in data and note_text:
            print(f"  Extracting investment thesis for {full_title}...")
            data["investment_thesis"] = extract_investment_thesis(note_text)

        # Backfill market_sentiment if missing
        if "market_sentiment" not in data and note_text:
            print(f"  Extracting market sentiment for {full_title}...")
            data["market_sentiment"] = extract_sentiment_score(note_text)

        # Upsert into podcast index (always overwrite to pick up new fields like themes)
        doc = {k: v for k, v in data.items() if k != "embeddings"}
        elastic_client.index(index=INDEX_NAME, id=full_title, document=doc)

        if not note_text:
            print(f"  No note text, skipping chunks for {full_title}")
            # Still save themes back to JSON if we added them
            with open(note_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
            continue

        # Delete existing chunks for this episode and rebuild from note
        elastic_client.delete_by_query(index="podcast_chunks", query={
            "term": {"fullTitle": full_title}
        })
        embeddings = index_chunks(full_title, "Gooaye", episode, upload_date, note_text)

        # Save embeddings (and any new fields like themes) back to JSON
        data["embeddings"] = embeddings
        with open(note_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        print(f"  Saved embeddings back to {note_path}")

    print("Reindex from notes complete.")


# Main process based on argument
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python main.py <local|test|reindex>")
        sys.exit(1)

    mode = sys.argv[1].lower()
    if mode in ("test", "local"):
        print("Running in local mode...")
        test_process()
    elif mode == "reindex":
        print("Reindexing from notes/gooaye/...")
        reindex_from_notes()
    else:
        print("Invalid argument. Use 'local' or 'reindex'.")
        sys.exit(1)
