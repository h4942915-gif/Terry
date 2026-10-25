# 蘑菇雷達

給全球 Pikmin Bloom 玩家用的免費蘑菇地圖：玩家回報看到的蘑菇（屬性、大小、剩餘時間、位置），其他人可以瀏覽、篩選，按「我想打」，再加回報者好友碼，由對方在遊戲內邀請。

本站只收玩家手動回報的資料，不連接遊戲帳號、不修改 GPS 定位。本站與 Niantic、任天堂無關。

## 開發階段

1. **蘑菇地圖**（目前）
2. 好友碼交換：`profiles.share_code` / `friend_code` 已預留
3. 組隊匹配：`parties` / `party_members` 已預留

## 技術

- 純靜態網站（不需要建置）：`index.html`、`style.css`、`app.js`、`store.js`、`config.js`
- 地圖：Leaflet + OpenStreetMap 圖磚；點地圖時用 Nominatim 查地名
- 資料庫：Supabase（Postgres + 匿名登入 + 即時更新）。`config.js` 留空時是「示範模式」，資料只存在瀏覽器
- 主機：GitHub Pages（免費）

## 上線步驟

1. **Supabase**：到 supabase.com 建立免費專案。
   - Authentication → Sign In / Providers → 開啟 **Anonymous sign-ins**
   - SQL Editor → 貼上 `supabase/schema.sql` 全部內容 → Run
   - Project Settings → API → 複製 Project URL 與 anon / publishable key，填進 `config.js`
2. **GitHub Pages**：repo 的 Settings → Pages → Source 選 `Deploy from a branch`，Branch 選 `main`、資料夾 `/ (root)`。
3. （選用）Supabase → Integrations → Cron，每小時執行 `select public.cleanup_old_mushrooms();` 清掉過期資料。

## 本機預覽

```
python3 -m http.server 8000
```
然後打開 http://localhost:8000
