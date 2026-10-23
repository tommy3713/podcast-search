"""Step 1 of the opinion-timeline design: per-episode reason extraction.

For one episode and one company, send the raw transcript (`content`, not the GPT
`note`) to the LLM and ask for self-contained reasons. By default the whole
episode goes in one call: with gpt-5.5 that beat 4000-char windows on recall,
and gpt-4o windows returned nothing for episodes where the company is a side
topic. `--window N` still cuts overlapping windows and drops cross-window
duplicates.

Usage:
    python extract_reasons.py EP464 "輝達（NVIDIA / NVDA）"
    python extract_reasons.py EP464 "輝達（NVIDIA / NVDA）" --window 4000 --overlap 1000 --out out.json
"""
import os
import re
import sys
import json
import glob
import argparse
from difflib import SequenceMatcher
import opencc
from openai import OpenAI
from dotenv import load_dotenv
load_dotenv()

NOTES_DIR = os.path.join(os.path.dirname(__file__), "..", "notes", "gooaye")

WINDOW_CHARS = 0      # 0 = whole episode in one call; 4000 holds one full topic when windowing
OVERLAP_CHARS = 1000  # so a reason cut at a window edge appears whole in the next window
MODEL = "gpt-5.5"
DEDUP_RATIO = 0.6     # reference similarity above this = same reason (interim rule)

openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Some transcripts are Simplified Chinese (辉达); match aliases against a Traditional copy
_s2tw = opencc.OpenCC("s2twp")

# Token usage summed across all calls in this run
usage = {"prompt_tokens": 0, "completion_tokens": 0, "calls": 0}

SYSTEM_PROMPT = """你是財經研究助理。你會讀到股癌（Gooaye）podcast 逐字稿的一個片段，任務是把這個片段中跟 {company} 有關的每一個論點都整理出來，不要遺漏。

<定義>
「理由」是這個片段中跟 {company} 有關的任何一個具體論點、事實、轉述的新聞或判斷，不限於看多或看空的理由。
主持人轉述別人的說法、反駁別人的說法、對 {company} 未來的預測、對 {company} 商業模式的觀察，都各算一條，分開列。
每條理由必須「自身完整」（self-contained）：讀者不需要回頭看逐字稿前後文，單獨讀這一句就能完整理解主詞、對象、動作。
脫離上下文會看不懂的（例如沒交代清楚「誰要做什麼」、「為什麼跟 {company} 有關」），不合格、不該被抽出。
如果是主持人轉述別人的說法，要在理由裡寫清楚是誰說的（例如「The Information 報導…」），不要把轉述當成主持人自己的看法。
這段的主角是其他公司、{company} 只是背景時，也要列出，focus 標「背景」。例如「某散熱廠因為打進 {company} 新一代伺服器，營收大幅成長」，主角是散熱廠的營收，{company} 是背景。主角就是 {company} 時，focus 標「主角」。
背景的理由一樣要「自身完整」，要寫清楚它跟 {company} 的關係。
{company} 只是被拿來當比喻或形容（例如廣告裡說「像某公司 CEO 一樣拚」），不涉及 {company} 本身的事實或判斷時，不算一條。
</定義>

<好理由範例>
reason：聯發科這次完成了一筆高達 35 億美元的海外可轉債（ECB）募資，不僅創下史上最高金額紀錄，更引來輝達與 Alphabet 等科技巨頭以策略投資人身分入股。
reference：然後聯發科這次那個ECB 就是海外可轉債 募了三十五億美金 這個是史上最大的 然後重點是 進來認購的有輝達 還有Alphabet 他們是用策略投資人的身分進來的
focus：背景（主角是聯發科的募資，輝達是入股的投資人）
合格原因：主詞（聯發科）、事件（ECB 募資 35 億美元）、與輝達的關係（以策略投資人身分入股）都交代清楚，單獨讀就懂。
</好理由範例>

<壞理由範例>
reason：Samsung 要自己做 base die。
合格原因：不合格。看不出 Samsung 為什麼要自己做、base die 是用在哪裡、跟 {company} 有什麼關係，必須回頭看前面的故事脈絡才看得懂。
</壞理由範例>

<輸出規則>
- 只輸出 JSON，格式：{{"reasons": [{{"reason": "string", "reference": "string", "focus": "主角|背景"}}]}}
- reason：用你自己的話統整改寫成一句書面化的繁體中文，要符合「自身完整」。
- reference：從逐字稿原文直接複製對應片段，保留口語贅字，不要改寫、不要修正錯字（供人工核對用）。
- reference 必須單獨就能證明 reason 裡的每一個主要事實（誰、做了什麼、跟 {company} 的關係）。只有轉折語或結論句（例如「所以用這樣的邏輯去看」）不合格，要把前面支撐的內容一起複製進來。
- 逐字稿是語音辨識結果，沒有標點，公司名稱可能被聽錯（例如「灰達」其實是「輝達」），請依上下文判斷。
- 同一個論點只列一次，但不同論點要分開列，寧可多列也不要漏掉。
- {company} 在逐字稿中可能以簡稱出現（例如 NV），也可能沒有直接點名但明顯在講它（例如「他們」），確定指的是 {company} 才納入。
- 這個片段沒有提到 {company}，或提到了但沒有任何合格理由，回傳 {{"reasons": []}}。
</輸出規則>"""


def load_episode(episode):
    """Find notes/gooaye/*<episode>*.json and return its parsed content."""
    matches = glob.glob(os.path.join(NOTES_DIR, f"*{episode}*.json"))
    if len(matches) != 1:
        sys.exit(f"Expected exactly one note for {episode}, found {len(matches)}: {matches}")
    with open(matches[0], "r", encoding="utf-8") as f:
        return json.load(f)


def split_windows(text, window=WINDOW_CHARS, overlap=OVERLAP_CHARS):
    """Cut text into overlapping windows on space boundaries.

    Whisper output has no punctuation — phrases are separated by spaces — so a
    space is the closest thing to a sentence boundary we have.
    """
    if window <= 0:
        return [text]
    segments = [s for s in text.split(" ") if s]
    windows = []
    start = 0
    while start < len(segments):
        end, length = start, 0
        while end < len(segments) and (length + len(segments[end]) <= window or end == start):
            length += len(segments[end]) + 1
            end += 1
        windows.append(" ".join(segments[start:end]))
        if end >= len(segments):
            break
        # Step back from `end` until the tail we keep is ~overlap chars
        next_start, tail = end, 0
        while next_start > start + 1 and tail < overlap:
            next_start -= 1
            tail += len(segments[next_start]) + 1
        start = next_start
    return windows


def extract_from_window(company, window_text, model=MODEL):
    """Return the window's reasons, or None if every attempt failed (so callers don't mistake it for "no reasons")."""
    for attempt in range(1, 4):
        try:
            response = openai_client.chat.completions.create(
                model=model,
                # Reasoning models (gpt-5.x, o-series) only accept the default temperature
                **({"temperature": 0} if model.startswith("gpt-4") else {}),
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT.format(company=company)},
                    {"role": "user", "content": f"<逐字稿>\n{window_text}\n</逐字稿>"},
                ],
            )
            usage["prompt_tokens"] += response.usage.prompt_tokens
            usage["completion_tokens"] += response.usage.completion_tokens
            usage["calls"] += 1
            result = json.loads(response.choices[0].message.content)
            reasons = result.get("reasons", [])
            # Validate shape
            return [
                {
                    "reason": r["reason"].strip(),
                    "reference": r["reference"].strip(),
                    "focus": r.get("focus") if r.get("focus") in ("主角", "背景") else "主角",
                }
                for r in reasons
                if isinstance(r.get("reason"), str) and isinstance(r.get("reference"), str)
            ]
        except Exception as e:
            print(f"  Window extraction attempt {attempt}/3 failed: {e}", file=sys.stderr)
            if attempt == 3:
                return None


def company_aliases(company, extra=None):
    """'輝達（NVIDIA / NVDA / NV）' → ['輝達', 'NVIDIA', 'NVDA', 'NV'] plus any --aliases."""
    parts = re.split(r"[（）()/、,，\s]+", company)
    return [a for a in parts + (extra or []) if a]


def alias_pattern(aliases):
    """Regex for any alias; Latin aliases must not touch other letters, so NV doesn't match inventory."""
    parts = []
    for a in aliases:
        p = re.escape(a)
        if re.fullmatch(r"[A-Za-z0-9 .&-]+", a):
            p = rf"(?<![A-Za-z]){p}(?![A-Za-z])"
        parts.append(p)
    return re.compile("|".join(parts), re.IGNORECASE)


def mentions(alias_re, text):
    return bool(alias_re.search(text) or alias_re.search(_s2tw.convert(text)))


def normalize(text):
    # Strip whitespace and punctuation: the model often adds 。，to quotes from an unpunctuated transcript
    return re.sub(r"[\s，。！？、,.!?「」\"']+", "", text)


def dedup(reasons):
    """Interim cross-window dedup: drop a reason whose reference overlaps an earlier one.

    Only catches the same passage extracted twice from overlapping windows.
    "Same reason, different wording" is the open semantic-dedup problem.
    """
    kept = []
    for r in reasons:
        ref = normalize(r["reference"])
        if any(
            ref in normalize(k["reference"]) or normalize(k["reference"]) in ref
            or SequenceMatcher(None, ref, normalize(k["reference"])).ratio() >= DEDUP_RATIO
            for k in kept
        ):
            continue
        kept.append(r)
    return kept


def extract_episode(data, company, model=MODEL, window=WINDOW_CHARS, overlap=OVERLAP_CHARS, aliases=None, use_filter=True):
    """Run extraction on one parsed note; returns the result dict (`failed_windows` non-empty = incomplete)."""
    content = data.get("content", "")
    windows = split_windows(content, window, overlap)
    aliases = aliases or company_aliases(company)
    alias_re = alias_pattern(aliases)
    before = dict(usage)
    print(f"{data.get('fullTitle')}: {len(content)} chars → {len(windows)} windows", file=sys.stderr)

    raw, skipped, failed = [], [], []
    for i, window_text in enumerate(windows):
        # Keyword pre-filter: a window that never names the company almost always returns []
        if use_filter and not mentions(alias_re, window_text):
            skipped.append(i)
            print(f"  window {i}: skipped (no {'/'.join(aliases)})", file=sys.stderr)
            continue
        found = extract_from_window(company, window_text, model)
        if found is None:
            failed.append(i)
            continue
        print(f"  window {i}: {len(found)} reasons", file=sys.stderr)
        for r in found:
            # A reference that isn't in the window is a paraphrase or a hallucination
            r["reference_found"] = normalize(r["reference"]) in normalize(window_text)
            # Flag, don't drop: a pronoun reference (「他們」) can still be about the company
            r["reference_mentions_company"] = mentions(alias_re, r["reference"])
            r["window"] = i
            raw.append(r)

    return {
        "episode": f"EP{data.get('episode')}",
        "fullTitle": data.get("fullTitle"),
        "company": company,
        "model": model,
        "window": window,
        "overlap": overlap,
        "windows": len(windows),
        "skipped_windows": skipped,
        "failed_windows": failed,
        "raw_count": len(raw),
        "usage": {k: usage[k] - before[k] for k in usage},
        "reasons": dedup(raw),
    }


def main():
    parser = argparse.ArgumentParser(description="Extract self-contained reasons about a company from one episode.")
    parser.add_argument("episode", help="Episode id as in the note filename, e.g. EP464")
    parser.add_argument("company", help="Company name with aliases, e.g. '輝達（NVIDIA / NVDA）'")
    parser.add_argument("--window", type=int, default=WINDOW_CHARS, help="Window size in chars; 0 = whole episode")
    parser.add_argument("--overlap", type=int, default=OVERLAP_CHARS)
    parser.add_argument("--model", default=MODEL)
    parser.add_argument("--aliases", nargs="*", default=[], help="Extra names to look for in windows and references, e.g. 灰達 黃仁勳")
    parser.add_argument("--no-filter", action="store_true", help="Send every window to the LLM, even ones that never name the company")
    parser.add_argument("--out", help="Write result JSON here (default: stdout only)")
    args = parser.parse_args()

    data = load_episode(args.episode)
    aliases = company_aliases(args.company, args.aliases)
    result = extract_episode(data, args.company, args.model, args.window, args.overlap, aliases, not args.no_filter)
    output = json.dumps(result, ensure_ascii=False, indent=2)
    print(output)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(output)


if __name__ == "__main__":
    main()
