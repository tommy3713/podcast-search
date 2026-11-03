## 做了什麼

## 怎麼測的

- [ ] `npm run check`（typecheck + test + build）
- [ ] `/code-review`
- [ ] 手動測過（`npm run dev` / `DB_PATH=data/prod.db npm run dev`）：

## 部署

合併後會自動部署（worker 會等手上的工作做完才更新）。

- [ ] 有資料庫 migration（只能新增欄位或資料表，舊版 worker 要能在新 schema 上繼續跑）
- [ ] 改了 `deploy/proxy/`（共用 Caddy 不會自動部署，要手動跑 `deploy/proxy/deploy.sh`）
