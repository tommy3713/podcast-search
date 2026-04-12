import os
import sys
import math
import re
import subprocess
import textwrap
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

# Directories
PODCAST_DIR = "../podcasts/gooaye"
NOTES_DIR = "../notes/gooaye"
TEMP_DIR = "./data/temp"
CONFIG_FILE = "./config.json"

MAX_WHISPER_BYTES = 24 * 1024 * 1024  # 24MB — Whisper limit
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


# Function: Split audio only when file exceeds Whisper's 25MB limit.
# Uses ffmpeg directly to copy the stream without re-encoding, preserving audio quality.
def split_audio_if_needed(file_path, output_dir):
    file_size = os.path.getsize(file_path)
    if file_size <= MAX_WHISPER_BYTES:
        return [file_path]

    num_parts = math.ceil(file_size / MAX_WHISPER_BYTES)
    print(f"File is {file_size / 1024 / 1024:.1f}MB, splitting into {num_parts} parts...")

    # Get total duration in seconds via ffprobe
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", file_path],
        capture_output=True, text=True, check=True
    )
    total_duration = float(result.stdout.strip())
    part_duration = total_duration / num_parts

    os.makedirs(output_dir, exist_ok=True)
    parts = []
    for i in range(num_parts):
        start = i * part_duration
        part_path = os.path.join(output_dir, f"part_{i + 1}.mp3")
        subprocess.run(
            ["ffmpeg", "-y", "-ss", str(start), "-t", str(part_duration),
             "-i", file_path, "-ar", "16000", "-ac", "1", "-b:a", "64k", part_path],
            check=True, capture_output=True
        )
        parts.append(part_path)
        print(f"  Created {os.path.basename(part_path)} ({os.path.getsize(part_path) / 1024 / 1024:.1f}MB)")

    return parts


# Proper nouns hint for Whisper — add any terms that get consistently misheard
WHISPER_PROMPT = "股癌，謝孟恭，Gooaye，台股，美股，Fed，聯準會，ETF，殖利率，通膨，升息，降息，半導體，台積電，輝達，NVIDIA，蘋果，Google，Meta，特斯拉，股海"

# Function: Transcribe audio using OpenAI Whisper
def transcribe_audio(file_path):
    print(f"Transcribing {os.path.basename(file_path)}...")
    for attempt in range(1, 4):
        try:
            with open(file_path, "rb") as audio_file:
                transcription = openai_client.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file,
                    response_format="verbose_json",
                    language="zh",
                    prompt=WHISPER_PROMPT,
                )
            print("Transcription completed.")
            return transcription
        except Exception as e:
            print(f"  Transcription attempt {attempt}/3 failed: {e}")
            if attempt == 3:
                raise RuntimeError(f"Transcription failed after 3 attempts: {e}")


MAX_TRANSCRIPTION_CHARS = 60000  # ~20k tokens for Chinese text, safely under gpt-4o-mini's 128k limit

# Function: Summarize transcription using OpenAI GPT
def summarize_transcription(transcription_text):
    print("Summarizing transcription...")

    truncated = transcription_text[:MAX_TRANSCRIPTION_CHARS]
    if len(transcription_text) > MAX_TRANSCRIPTION_CHARS:
        print(f"  Transcription truncated from {len(transcription_text)} to {MAX_TRANSCRIPTION_CHARS} chars.")

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


# Function: Save final result to notes/gooaye/ in the project's standard JSON format
def save_to_notes(file_name, podcaster, title, episode, upload_date, content, note, embeddings=None):
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
    with open(note_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    print(f"Saved note to {note_path}")


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
def index_transcription(file_name, podcaster, title, episode, full_transcription_text, uploadDate, note=None):
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
    response = elastic_client.index(index=INDEX_NAME, document=document)
    print(f"Document indexed in Elasticsearch: {response}")


# Function: Check if episode is already processed by looking for its JSON in notes/
def is_already_processed(file_name):
    note_name = os.path.splitext(file_name)[0]
    return os.path.exists(os.path.join(NOTES_DIR, f"{note_name}.json"))


# Function: Check if episode is already indexed in ES (used in production mode)
def is_in_elasticsearch(file_name):
    result = elastic_client.search(index=INDEX_NAME, query={
        "term": {"fullTitle": file_name}
    })
    return result["hits"]["total"]["value"] > 0


# Function: Clean up split temp parts only (keep original MP3s in podcasts/)
def clean_data_folder():
    print("Cleaning up temp files...")
    if os.path.exists(TEMP_DIR):
        for file_name in os.listdir(TEMP_DIR):
            file_path = os.path.join(TEMP_DIR, file_name)
            try:
                if os.path.isfile(file_path):
                    os.unlink(file_path)
                    print(f"Deleted: {file_path}")
            except Exception as e:
                print(f"Failed to delete {file_path}: {e}")
    print("Cleanup completed.")


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
            clean_data_folder()
            return

        date, episode, title = parse_filename(file_name)
        print(f"Date: {date}, Episode: {episode}, Title: {title}")

        file_path = os.path.join(PODCAST_DIR, file_name)

        # Transcribe (split only if needed)
        parts = split_audio_if_needed(file_path, TEMP_DIR)
        full_transcription_text = ""
        for part in parts:
            transcription = transcribe_audio(part)
            full_transcription_text += transcription.text + " "

        # Summarize
        summary = summarize_transcription(full_transcription_text)

        # Index in ES
        index_transcription(file_name, "Gooaye", title, episode, full_transcription_text, date, note=summary)
        embeddings = index_chunks(file_name, "Gooaye", episode, date, summary)

        # Save to notes/gooaye/ (with embeddings cached)
        save_to_notes(file_name, "Gooaye", title, episode, date, full_transcription_text, summary, embeddings=embeddings)

        clean_data_folder()
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

        # Upsert into podcast index
        already_in_es = elastic_client.exists(index=INDEX_NAME, id=full_title)
        if not already_in_es:
            doc = {k: v for k, v in data.items() if k != "embeddings"}
            elastic_client.index(index=INDEX_NAME, id=full_title, document=doc)

        if not note_text:
            print(f"  No note text, skipping chunks for {full_title}")
            continue

        # Delete existing chunks for this episode and rebuild from note
        elastic_client.delete_by_query(index="podcast_chunks", query={
            "term": {"fullTitle": full_title}
        })
        embeddings = index_chunks(full_title, "Gooaye", episode, upload_date, note_text)

        # Save new embeddings back to JSON
        data["embeddings"] = embeddings
        with open(note_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        print(f"  Saved embeddings back to {note_path}")

    print("Reindex from notes complete.")


# Main process based on argument
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python main.py <local|reindex>")
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
