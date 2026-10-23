"""Step 2b of the opinion-timeline design: render match_threads.py output as a thread × episode matrix.

Pure code, no LLM. Each row is a thread, each column an episode; a cell shows how
that episode's reasons relate to the thread (新增 / 更新 / 反轉 / 重複). A thread
not mentioned in the last --dormant episodes that said anything about the company
is shown as 沉寂: not mentioning it is not the same as dropping it.

Usage:
    python render_threads.py experiments/nvda_threads.json --out experiments/nvda_threads.html
"""
import json
import argparse
from html import escape

DORMANT_EPISODES = 3
SITE_URL = "http://localhost:3001"
# When one cell holds several reasons, show the most informative relation
PRIORITY = ["反轉", "新增", "更新", "重複"]
SYMBOLS = {"新增": "●", "更新": "◐", "反轉": "⇄", "重複": "·"}

PAGE = """<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>論點時間軸</title>
<style>
:root {{
  --bg: #fafaf9; --surface: #ffffff; --text: #1c1917; --muted: #78716c; --line: #e7e5e4;
  --new: #2563eb; --update: #059669; --flip: #dc2626; --repeat: #a8a29e; --hover: #f5f5f4;
}}
@media (prefers-color-scheme: dark) {{
  :root {{
    --bg: #1c1917; --surface: #292524; --text: #f5f5f4; --muted: #a8a29e; --line: #44403c;
    --new: #60a5fa; --update: #34d399; --flip: #f87171; --repeat: #78716c; --hover: #36302c;
  }}
}}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.6 -apple-system, "PingFang TC", "Noto Sans TC", sans-serif; }}
main {{ max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }}
h1 {{ font-size: 22px; margin: 0 0 4px; }}
.sub {{ color: var(--muted); font-size: 13px; margin: 0 0 20px; }}
.legend {{ display: flex; flex-wrap: wrap; gap: 16px; font-size: 13px; color: var(--muted); margin-bottom: 12px; }}
.scroll {{ overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }}
table {{ border-collapse: collapse; width: 100%; }}
th, td {{ border-bottom: 1px solid var(--line); padding: 8px 10px; text-align: center; white-space: nowrap; }}
th.thread {{ text-align: left; font-weight: 500; white-space: normal; min-width: 180px; position: sticky; left: 0; background: var(--surface); }}
thead th {{ font-size: 13px; color: var(--muted); font-weight: 500; cursor: pointer; }}
thead th:hover {{ color: var(--text); }}
thead th small {{ display: block; font-size: 11px; }}
tr.dormant th.thread {{ color: var(--muted); }}
tr.dormant th.thread::after {{ content: "沉寂"; font-size: 11px; margin-left: 6px; padding: 1px 6px; border: 1px solid var(--line); border-radius: 4px; }}
td.cell {{ cursor: pointer; font-size: 18px; }}
td.cell:hover, td.cell.active {{ background: var(--hover); }}
td.cell sup {{ font-size: 10px; color: var(--muted); }}
td.cell.bg {{ opacity: .4; }}
.badge {{ font-size: 11px; padding: 0 6px; border: 1px solid var(--line); border-radius: 4px; }}
.r-新增 {{ color: var(--new); }} .r-更新 {{ color: var(--update); }} .r-反轉 {{ color: var(--flip); }} .r-重複 {{ color: var(--repeat); }}
#detail {{ margin-top: 20px; }}
.card {{ background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; margin-bottom: 10px; }}
.card .meta {{ font-size: 13px; color: var(--muted); margin-bottom: 4px; }}
.card .why {{ font-size: 13px; color: var(--muted); margin-top: 6px; }}
.card details {{ margin-top: 8px; font-size: 13px; }}
.card details p {{ color: var(--muted); margin: 6px 0 0; }}
.card a {{ color: var(--new); }}
.hint {{ color: var(--muted); font-size: 14px; }}
</style>
</head>
<body>
<main>
<h1>{company}：論點時間軸</h1>
<p class="sub">{episode_range}，{reason_count} 條理由，{thread_count} 個主題。點格子看該集的理由；點集數看那一集跟之前相比的變化。</p>
<div class="legend">
  <span><span class="r-新增">●</span> 新增</span><span><span class="r-更新">◐</span> 更新</span>
  <span><span class="r-反轉">⇄</span> 反轉</span><span><span class="r-重複">·</span> 重複</span>
  <span>淡色＝輝達只是背景</span><span>空白＝沒提到</span><span>沉寂＝最近 {dormant} 集都沒提到</span>
</div>
<div class="scroll"><table>
<thead><tr><th class="thread">主題</th>{header}</tr></thead>
<tbody>{rows}</tbody>
</table></div>
<section id="detail"><p class="hint">點一個格子或集數。</p></section>
</main>
<script>
const DATA = {data};
const detail = document.getElementById("detail");
const esc = s => s.replace(/[&<>"]/g, c => ({{"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}})[c]);
const card = (thread, h) => `<div class="card">
  <div class="meta"><span class="r-${{h.relation}}">${{h.relation}}</span> · ${{esc(h.episode)}}（${{h.date}}）· ${{esc(thread.label)}}${{h.focus === "背景" ? ' <span class="badge">背景</span>' : ""}}</div>
  <div>${{esc(h.reason)}}</div>
  ${{h.why ? `<div class="why">歸類說明：${{esc(h.why)}}</div>` : ""}}
  <details><summary>逐字稿原文</summary><p>${{esc(h.reference)}}</p>
  <p><a href="${{DATA.site}}/summary/Gooaye/${{h.episode.replace(/^EP/, "")}}" target="_blank">打開這集逐字稿 →</a></p></details>
</div>`;
function activate(el) {{
  document.querySelectorAll(".active").forEach(e => e.classList.remove("active"));
  if (el) el.classList.add("active");
}}
document.querySelectorAll("td.cell").forEach(td => td.addEventListener("click", () => {{
  activate(td);
  const thread = DATA.threads.find(t => t.id === td.dataset.thread);
  const hs = thread.history.filter(h => h.episode === td.dataset.episode);
  const before = thread.history.filter(h => h.date < hs[0].date);
  detail.innerHTML = `<h2>${{esc(thread.label)}}｜${{esc(td.dataset.episode)}}</h2>` + hs.map(h => card(thread, h)).join("")
    + (before.length ? `<p class="hint">這個主題之前的說法：</p>` + before.slice(-2).map(h => card(thread, h)).join("") : "");
}}));
document.querySelectorAll("thead th[data-episode]").forEach(th => th.addEventListener("click", () => {{
  activate(null);
  const ep = th.dataset.episode;
  const groups = {{"反轉": [], "新增": [], "更新": [], "重複": []}};
  DATA.threads.forEach(t => t.history.filter(h => h.episode === ep).forEach(h => groups[h.relation].push([t, h])));
  const total = Object.values(groups).reduce((n, g) => n + g.length, 0);
  detail.innerHTML = `<h2>${{esc(ep)}} 跟之前相比</h2>` + (total ? Object.entries(groups)
    .filter(([, g]) => g.length)
    .map(([rel, g]) => `<p class="hint"><span class="r-${{rel}}">${{rel}}</span> ${{g.length}} 條</p>` + g.map(([t, h]) => card(t, h)).join(""))
    .join("") : `<p class="hint">這集沒有抽到任何理由。</p>`);
}}));
</script>
</body>
</html>
"""


def cell_relation(entries):
    return min((e["relation"] for e in entries), key=PRIORITY.index)


def render(data, dormant=DORMANT_EPISODES, site=SITE_URL):
    episodes = data["episodes"]
    threads = data["threads"]
    # Dormancy counts only episodes that said something about the company
    speaking = [e["episode"] for e in episodes if e["reason_count"]]
    recent = set(speaking[-dormant:])

    header = "".join(
        f'<th data-episode="{escape(e["episode"])}">{escape(e["episode"])}<small>{e["date"][:4]}-{e["date"][4:6]}-{e["date"][6:]}</small></th>'
        for e in episodes
    )
    rows = []
    for t in threads:
        mentioned = {h["episode"] for h in t["history"]}
        cells = []
        for e in episodes:
            entries = [h for h in t["history"] if h["episode"] == e["episode"]]
            if not entries:
                cells.append("<td></td>")
                continue
            rel = cell_relation(entries)
            count = f"<sup>{len(entries)}</sup>" if len(entries) > 1 else ""
            # Fade a cell when the company was only background in every reason it holds
            bg = " bg" if all(h.get("focus") == "背景" for h in entries) else ""
            cells.append(
                f'<td class="cell r-{rel}{bg}" data-thread="{t["id"]}" data-episode="{escape(e["episode"])}" '
                f'title="{rel}">{SYMBOLS[rel]}{count}</td>'
            )
        dormant_cls = "" if mentioned & recent else ' class="dormant"'
        rows.append(f'<tr{dormant_cls}><th class="thread">{escape(t["label"])}</th>{"".join(cells)}</tr>')

    payload = {"site": site, "threads": threads}
    return PAGE.format(
        company=escape(data["company"]),
        episode_range=f'{episodes[0]["episode"]}–{episodes[-1]["episode"]}' if episodes else "",
        reason_count=sum(len(t["history"]) for t in threads),
        thread_count=len(threads),
        dormant=dormant,
        header=header,
        rows="".join(rows),
        # </script> inside a reference would close the script tag early
        data=json.dumps(payload, ensure_ascii=False).replace("</", "<\\/"),
    )


def main():
    parser = argparse.ArgumentParser(description="Render a thread × episode matrix from match_threads.py output.")
    parser.add_argument("threads", help="match_threads.py output JSON")
    parser.add_argument("--dormant", type=int, default=DORMANT_EPISODES, help="Mark a thread 沉寂 when absent from this many latest episodes")
    parser.add_argument("--site", default=SITE_URL, help="Frontend base URL for transcript links")
    parser.add_argument("--out", required=True, help="Write HTML here")
    args = parser.parse_args()

    with open(args.threads, "r", encoding="utf-8") as f:
        data = json.load(f)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(render(data, args.dormant, args.site))


if __name__ == "__main__":
    main()
