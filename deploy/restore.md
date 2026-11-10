# 備份與還原

每晚 03:00（台北）worker 把 `app.db` 備份到 Cloudflare R2 的 `backups/app-YYYY-MM-DD.db.gz`，保留 30 天（bucket 的 lifecycle 規則會刪掉更舊的）。上傳前會跑 `PRAGMA integrity_check`；備份失敗、內容損毀、已上線集數變少或磁碟快滿，會發 Telegram 並讓 Healthchecks 的備份檢查變紅。

集數變少的警報**每晚都會重發**，直到處理完為止，因為 R2 只留 30 天，拖太久好的備份就會被刪光。如果是你刻意刪了集數，到 VPS 刪掉 `/opt/gooaye/data/app.db.backup-state.json` 重設基準。

## 每季還原演練

目的是確認「備份真的救得回來」，不是只確認「備份有上傳」。全部在本機做，不碰正式環境。

1. 到 Cloudflare 後台 → R2 → 備份的 bucket → `backups/`，下載最新一份 `app-YYYY-MM-DD.db.gz`。
2. 解壓並檢查：

   ```bash
   gunzip -c ~/Downloads/app-YYYY-MM-DD.db.gz > data/restore.db
   npm run worker -- check-db data/restore.db
   # 預期：integrity ok, <N> live episodes（N 和網站首頁的集數一致）
   ```

   不要用系統的 `sqlite3` 檢查：它沒有載入 sqlite-vec，碰到向量表會報錯。
3. 用這份資料把網站跑起來，點幾集看重點和逐字稿：

   ```bash
   DB_PATH=data/restore.db npm run dev
   ```

4. 記錄演練日期和結果（Notion 計畫頁），然後刪掉 `data/restore.db`。

## 真的要還原時（正式環境）

會遺失備份之後的變動：之後上線的集數（worker 會從 RSS 自動重新處理，因為它只看「比資料庫最新一集更新的」）。

問答紀錄（`ask_log`）則是全部歸零：備份刻意不含任何問答內容（`/about` 承諾問答 30 天後刪除，而 R2 上的備份會再留 30 天），所以還原後 `/questions`、`/stats` 和每週摘要的「沒出處的問題」都從空的開始。每日統計 `ask_daily` 還在，但備份當天的數字少了 00:00–03:00 那段。

1. 先在 Telegram 看 `/status`，確認沒有正在處理的集數。
2. 照上面第 1、2 步下載並在本機檢查備份。
3. 上傳並替換：

   ```bash
   scp -i ~/.ssh/gooaye_vps data/restore.db deploy@66.245.221.163:/opt/gooaye/data/restore.db
   ssh -i ~/.ssh/gooaye_vps deploy@66.245.221.163
   cd /opt/gooaye
   docker compose stop web worker
   mkdir -p data/broken && mv data/app.db data/app.db-wal data/app.db-shm data/broken/ 2>/dev/null
   mv data/restore.db data/app.db && chmod 600 data/app.db
   docker compose start worker web
   ```

   `-wal` / `-shm` 一定要一起移走：它們屬於舊的資料庫，留著會讓 SQLite 把舊資料套到新檔案上。
4. 確認網站正常、Telegram 收到「worker 已啟動」，`/status` 顯示的集數正確。
5. 確定沒問題後再刪 `data/broken/`。
