"""One-off: older-episode rows (EP < 676) for the prototype's paginated list, from notes/gooaye/."""
import datetime, glob, json, os, re

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', '..')
WD = '一二三四五六日'
NAMES = {'2330': '台積電', '2454': '聯發科', '2308': '台達電'}
rows = []
for f in sorted(glob.glob(os.path.join(ROOT, 'notes', 'gooaye', '*.json'))):
    d = json.load(open(f))
    no = int(d['episode'])
    if no >= 676:
        continue
    day = datetime.datetime.strptime(d['uploadDate'], '%Y%m%d').date()
    thesis = d.get('investment_thesis') or {}
    line = (thesis.get('macro_view') or '').strip() or '、'.join(d.get('themes') or [])
    rows.append({
        'no': no,
        'emoji': d['title'].strip(),
        'date': f"{day:%Y/%m/%d}（{WD[day.weekday()]}）",
        'min': round(len(d.get('content', '')) / 400),
        'line': re.sub(r'\s+', ' ', line),
        'stocks': [NAMES.get(t, t) for t in (d.get('mentioned_stocks') or [])[:4]],
    })
rows.sort(key=lambda r: -r['no'])
json.dump(rows, open(os.path.join(os.path.dirname(__file__), 'older_eps.json'), 'w'), ensure_ascii=False)
print(len(rows), rows[0], rows[-1])
