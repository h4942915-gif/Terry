# 皮克敏好友圈

給全球 Pikmin Bloom 玩家的免費社群網站：

- **附近動態**：依國家／城市分的討論版，可發討論、蘑菇、花點貼文（可附截圖、標地圖位置），留言和按讚
- **蘑菇地圖**：玩家分享、還沒結束的蘑菇與花點
- **好友碼**：公開自己的好友碼與想找的東西（交朋友、一起打蘑菇、交換明信片）
- **請在地玩家邀請我**：在蘑菇貼文上按「請邀請我」，分享的玩家加你好友碼後從遊戲內邀請你

所有內容都由玩家分享。本站不會連接、建立或操作任何遊戲帳號，也不會修改定位。本站與 Niantic、任天堂無關。

之後：組隊匹配（`parties` / `party_members` 已預留）。

## 技術

- 純靜態網站（不需要建置）：`index.html`、`style.css`、`app.js`、`store.js`、`config.js`
- 地圖：Leaflet + OpenStreetMap 圖磚；點地圖時用 Nominatim 查地名
- 圖片：上傳前在瀏覽器縮到 1280px JPEG，存在 Supabase Storage（`post-images`）
- 防濫用：發文／留言頻率限制、檢舉滿 3 次自動隱藏
- 資料庫：Supabase（Postgres + 匿名登入 + 即時更新）。`config.js` 留空時是「示範模式」，資料只存在瀏覽器
- 主機：GitHub Pages（免費）

## 上線步驟

1. **Supabase**：到 supabase.com 建立免費專案。
   - Authentication → Sign In / Providers → 開啟 **Anonymous sign-ins**
   - SQL Editor → 貼上 `supabase/schema.sql` 全部內容 → Run
   - Project Settings → API → 複製 Project URL 與 anon / publishable key，填進 `config.js`
2. **GitHub Pages**：repo 的 Settings → Pages → Source 選 `Deploy from a branch`，Branch 選 `main`、資料夾 `/ (root)`。

## 本機預覽

```
python3 -m http.server 8000
```
然後打開 http://localhost:8000
