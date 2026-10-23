"""Step 2a of the opinion-timeline design: group per-episode reasons into threads.

Walk the extract_reasons.py outputs in upload order. For each reason, show the LLM
the company's threads so far (label + latest reason); it assigns the reason to
an existing thread or opens a new one, and labels how it relates to that
thread's latest statement. The timeline itself
(what changed when) is then pure code over the result — see render_threads.py.

Usage:
    python match_threads.py "輝達（NVIDIA / NVDA）" experiments/EP46*_nvda_w4000.json --out experiments/nvda_threads.json
"""
import os
import re
import sys
import json
import argparse
from openai import OpenAI
from dotenv import load_dotenv
load_dotenv()

MODEL = "gpt-5.5"  # gpt-4o and gpt-5.4-mini let one broad thread swallow unrelated reasons
RELATIONS = ["新增", "重複", "更新", "反轉"]

openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Token usage summed across all calls in this run
usage = {"prompt_tokens": 0, "completion_tokens": 0, "calls": 0}

SYSTEM_PROMPT = """你是財經研究助理，正在整理股癌（Gooaye）podcast 主持人對 {company} 的論點，並依時間追蹤每個論點的變化。

你會拿到兩樣東西：
1. <既有主題>：目前整理出來的論點主題，每個主題有 id、標題，以及該主題最近一次的說法（附集數）。
2. <新理由>：剛從某一集抽出來、跟 {company} 有關的一條理由（附集數）。

你的任務：把這條新理由歸到一個主題，並標出它跟該主題「最近一次說法」的關係。

<主題的定義>
主題是一個中性、具體的討論面向：一個可以單獨被問「主持人現在怎麼看」的問題。
- 大小剛好的例子：「台積電毛利率」、「CSP 自研 ASIC 對台積電的影響」、「台積電海外設廠成本」、「主持人的台積電持股」。
- 太大、不可以用的例子：「台積電的競爭優勢」、「台積電的經營」、「台積電與客戶的關係」。這種標題什麼都裝得下，會把不同的問題混在一起。
- 太小、不可以用的例子：「台積電 6 月營收」，這是某個主題下的一次更新，不是主題本身。
標題只寫面向，不寫立場或結論：寫「台積電毛利率」，不寫「台積電毛利會被侵蝕」。這樣看法反轉時，前後兩種說法才會落在同一個主題。
同一個主題的主詞必須相同：「台積電的毛利率」和「台積電客戶的獲利」是兩個主題，即使兩句都提到「獲利被侵蝕」。
既有主題裡有講同一個具體問題的，就歸進去，不要因為措辭不同就開新主題；沒有的話就開新主題，不要硬塞進只是沾上邊的既有主題。
</主題的定義>

<關係的定義>
- 新增：開新主題時一律用這個。
- 重複：跟該主題最近一次說法講的是同一件事，沒有新資訊。
- 更新：同一個問題，但出現了新的事實、數字或細節，結論方向沒變。
- 反轉：同一個問題，而且結論跟最近一次說法方向相反（例如從「毛利守得住」變成「毛利會被侵蝕」，或從加碼變成減碼）。兩次說法方向一致時（例如兩次都說會被侵蝕），不是反轉。
</關係的定義>

<輸出規則>
- 只輸出 JSON，格式：{{"thread_id": "T1 或 null", "new_thread_label": "開新主題時填，否則為 null", "relation": "新增|重複|更新|反轉", "why": "一句話說明為什麼歸到這個主題、為什麼是這個關係"}}
- 歸到既有主題：填 thread_id，new_thread_label 為 null，relation 不能是「新增」。
- 開新主題：thread_id 為 null，填 new_thread_label，relation 為「新增」。
</輸出規則>"""


def episode_meta(result):
    """'[20240612] EP461   🍘' → ('EP461', '20240612')."""
    m = re.match(r"\[(\d{8})\]", result.get("fullTitle") or "")
    return result["episode"], m.group(1) if m else ""


def format_threads(threads):
    if not threads:
        return "（目前沒有任何主題）"
    lines = []
    for t in threads:
        latest = t["history"][-1]
        lines.append(f'{t["id"]}｜{t["label"]}｜最近一次（{latest["episode"]}）：{latest["reason"]}')
    return "\n".join(lines)


def assign(company, threads, episode, reason, model=MODEL):
    """One reason at a time, so a thread opened by the previous reason is already visible."""
    user = (
        f"<既有主題>\n{format_threads(threads)}\n</既有主題>\n\n"
        f"<新理由>\n（{episode}）{reason['reason']}\n</新理由>"
    )
    for attempt in range(1, 4):
        try:
            response = openai_client.chat.completions.create(
                model=model,
                # Reasoning models (gpt-5.x, o-series) only accept the default temperature
                **({"temperature": 0} if model.startswith("gpt-4") else {}),
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT.format(company=company)},
                    {"role": "user", "content": user},
                ],
            )
            usage["prompt_tokens"] += response.usage.prompt_tokens
            usage["completion_tokens"] += response.usage.completion_tokens
            usage["calls"] += 1
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            print(f"  Assignment attempt {attempt}/3 failed: {e}", file=sys.stderr)
            if attempt == 3:
                raise


def apply(threads, episode, date, reason, assignment):
    """Fold one assignment into `threads`, repairing inconsistent output."""
    relation = assignment.get("relation") if assignment.get("relation") in RELATIONS else "重複"
    thread = next((t for t in threads if t["id"] == assignment.get("thread_id")), None)
    if thread is None:
        label = (assignment.get("new_thread_label") or reason["reason"][:20]).strip()
        thread = {"id": f"T{len(threads) + 1}", "label": label, "history": []}
        threads.append(thread)
        relation = "新增"
    elif relation == "新增":
        # An existing thread can't be "new"; the model meant it continues the thread
        relation = "更新"
    thread["history"].append({
        "episode": episode,
        "date": date,
        "relation": relation,
        "reason": reason["reason"],
        "reference": reason["reference"],
        "focus": reason.get("focus", "主角"),
        "why": assignment.get("why", ""),
    })


def match(company, results, model=MODEL):
    """Fold extract_reasons.py results (any order) into threads; returns the output dict."""
    results = sorted(results, key=lambda r: episode_meta(r)[1])
    before = dict(usage)
    threads, episodes = [], []
    for result in results:
        episode, date = episode_meta(result)
        reasons = result.get("reasons", [])
        episodes.append({"episode": episode, "date": date, "fullTitle": result.get("fullTitle"), "reason_count": len(reasons)})
        if not reasons:
            print(f"{episode}: no reasons", file=sys.stderr)
            continue
        for reason in reasons:
            apply(threads, episode, date, reason, assign(company, threads, episode, reason, model))
        print(f"{episode}: {len(reasons)} reasons → {len(threads)} threads so far", file=sys.stderr)
    return {
        "company": company,
        "model": model,
        "usage": {k: usage[k] - before[k] for k in usage},
        "episodes": episodes,
        "threads": threads,
    }


def main():
    parser = argparse.ArgumentParser(description="Group extracted reasons into threads across episodes.")
    parser.add_argument("company", help="Company name with aliases, e.g. '輝達（NVIDIA / NVDA）'")
    parser.add_argument("results", nargs="+", help="extract_reasons.py output files, any order")
    parser.add_argument("--model", default=MODEL)
    parser.add_argument("--out", help="Write result JSON here (default: stdout only)")
    args = parser.parse_args()

    results = []
    for path in args.results:
        with open(path, "r", encoding="utf-8") as f:
            results.append(json.load(f))
    result = match(args.company, results, args.model)
    output = json.dumps(result, ensure_ascii=False, indent=2)
    print(output)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(output)


if __name__ == "__main__":
    main()
