// 填入 Supabase 專案的網址與 anon（publishable）key 之後，網站就會使用共享的線上資料庫。
// 這兩個值本來就是公開的（權限由 supabase/schema.sql 的 RLS 規則控管），可以放心提交到 repo。
// 留空時網站會進入「示範模式」，資料只存在你自己的瀏覽器。
window.MUSHROOM_RADAR_CONFIG = {
  supabaseUrl: "https://hcearzprnirmyoiqylrn.supabase.co",
  supabaseAnonKey: "sb_publishable_QzLM5if5fVhWhpWBfyYjrw_wUnEf62w"
};
