# MU Café POS

## GitHub Pages

推送到 `main` 後，`.github/workflows/pages.yml` 會以 `/mu-pos/` 路徑產生靜態網站並部署至 `https://rxing3569.github.io/mu-pos/`。儲存庫的 **Settings → Pages → Build and deployment → Source** 須選 **GitHub Actions**。工作流程只部署 `.output/public`；本機的 `.data`、`.env` 和 `node_modules` 不會上傳。

## 本機主資料與 PWA（開發中）

本機訂單與菜單使用 IndexedDB；存取密碼保存在此裝置的瀏覽器儲存空間。首次開啟不會建立預設菜單，需到設定頁手動從雲端下載。下載會以雲端菜單覆蓋本機菜單；雲端為空時本機也會清空。訂單與菜單只在使用者按下上傳或備份按鈕時同步，不會因切換頁面或重新載入自動上傳。已備份、超過 30 天的本機訂單在成功備份後清理；尚未備份的訂單不會自動刪除。

首次手動建立雲端菜單時，使用 `菜單` 工作表。第 1 列欄名依序為：`資料類型`、`資料鍵`、`分類`、`名稱`、`價格`、`排序`、`更新時間`、`冷熱選項`、`下個品項號碼`。分類列的資料類型填 `分類`，資料鍵、分類、名稱填相同分類名稱；品項列的資料類型填 `品項`，資料鍵使用「分類名稱-001」格式，分類填所屬分類，名稱與價格填品項資料。沒有冷熱選項時該欄可留空。填好後在設定頁按「下載菜單」，資料會直接儲存到本機。

PWA 首次安裝需在線上開啟；離線開啟與 iPad 實機使用仍需驗證。菜單設定頁路徑為 `/settings`，首次使用設定管理 PIN；此 PIN 僅防止一般誤操作，不能防止持有裝置資料的人繞過。更換裝置前須確認備份成功。Apps Script 程式已新增「菜單」分頁 API，必須更新部署才能使用菜單備份。

Nuxt 4 SSG，開發埠 3007。npm run dev 啟動，npm run generate 產生 .output/public。

## 月份訂單 v3

Google 試算表每月 YYYY-MM 一張工作表，一張訂單一列。UUID 為唯一值；可完整編輯、部分退單、實體刪除。營收按原結單月份計算，不提供支出或菜單資料表。

需將 [Code.gs](apps-script/Code.gs) 更新至 Apps Script 並部署新版本；見 [設定步驟](docs/apps-script-setup.md)。公開 URL 固定在 app/utils/apps-script.mjs，新版可選擇在本機記住存取密碼。舊表不讀寫、不自動刪除。

測試：node --test tests/*.test.mjs。靜態建置可本機驗證；Google 真實讀寫仍需在部署後以實際密碼測試。

訂單頁採展開卡片，營收總覽包含每日圖表與熱銷排行。每日流水號須重新部署 Apps Script v3；更新前舊單顯示「舊單」，UUID 仍可使用。

## v4 本機優先

訂單操作先存 IndexedDB，點「同步」才上傳；不需保持連線即可結單。新版 Code.gs 必須重新部署為 version:4，首次同步會建立隱藏 _SyncLog。月份初次下載分頁200筆，後續使用同步游標。舊版備份／還原入口已移除，重新編號仍位於訂單頁。

營收僅每日營收、本月營收、訂單數；每日圖表逐筆顯示「元」。使用內建圖表樣式，不增加圖表套件依賴。

已驗證資料模型與伺服端模擬同步，不代表真實 IndexedDB、iPad 版面或 Google 配額實測通過。npm audit 因環境DNS無法連線而未完成；參閱 docs/apps-script-setup.md 的安全及配額限制。單一主裝置操作；有 Web Locks 的瀏覽器會限制同時同步分頁。
