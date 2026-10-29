# 股癌搜尋

https://gooaye-notes.com

Podcast《股癌 Gooaye》的非官方筆記網站：

- **每集重點**：一句話摘要、章節、提到的股票，以及餐廳、運動、書影音等提及清單，每一項都附時間點。
- **逐字稿**：可以搜尋，點時間點會從那裡開始播放。
- **問答**：跨集數提問，回答會附上出處（第幾集、幾分幾秒），登入 Google 後每天可以問 20 題。

網站內容由 AI 根據逐字稿自動產生，可能有誤，請以原節目為準；不構成投資建議。本站與《股癌》節目及謝孟恭無關。

## 運作方式

```
SoundOn RSS ──▶ worker ──▶ SQLite ──▶ Next.js 網站
               │  Groq Whisper 轉錄
               │  GPT 整理重點
               │  向量索引（sqlite-vec）
               └─ Telegram 通知與操作
```

新集數上架當天，worker 會自動轉錄、整理重點並上線，每集大約 US$0.40。全部跑在一台 2 GB 的 VPS 上，用 Docker Compose 和 Caddy；資料庫每天備份到 Cloudflare R2。

## 本機開發

需要 Node 22 以上。

```bash
npm install
npm run dev:seed   # 用範例資料建立 data/dev.db，不需要任何 API key
npm run dev        # http://localhost:3005
npm test
```

要跑真的轉錄、整理重點或問答，把 `.env.example` 複製成 `.env.local` 並填入 key，再用 `npm run worker -- ingest <集數>` 處理單集。詳細說明在 [CLAUDE.md](CLAUDE.md)。

舊版（Express + Elasticsearch + Python）保留在 tag [`v1-es-final`](https://github.com/tommy3713/podcast-search/tree/v1-es-final)。
