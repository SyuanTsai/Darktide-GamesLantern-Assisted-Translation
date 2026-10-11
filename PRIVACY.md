# Darktide GamesLantern 繁中助手｜隱私政策

生效日期：2026 年 10 月 11 日 · 適用版本：0.2.28

本外掛在 https://darktide.gameslantern.com/ 的原有頁面顯示繁體中文遊戲資料與攻略補充。這是獨立社群工具，與 GamesLantern、Fatshark 或 Games Workshop 無官方關係。

## PoC 驗證與授權狀態

本工具目前僅供 PoC（概念驗證）使用，相關素材的使用授權正洽詢中。這是獨立社群工具，與 GamesLantern、Fatshark 或 Games Workshop 無官方關係，亦不代表已取得官方背書。

## 本機處理與儲存的資料

- **顯示偏好：**以 Chrome 本機儲存保存啟用狀態及顯示語言。這兩項設定不傳送給開發者，也不使用 Chrome 同步儲存。
- **當前頁面的遊戲資料：**在記憶體中辨識指定網站的當前路徑、遊戲項目文字及圖示網址，對照外掛內的翻譯資料後原位顯示。頁面內容不送往開發者或分析服務，也不持久儲存。
- **自由撰寫內容：**作者的攻略正文及輸入區不列為翻譯對象。外掛不儲存或上傳這些內容。

## 網路連線

為確認當前網站資料，本外掛在需要核對的頁面，每個頁面文件最多以 HTTPS GET 讀取一次 GamesLantern 的公開遊戲資料 API：

https://darktide.gameslantern.com/api/build-editor/initialize

此請求不附登入 Cookie（`credentials:omit`），沒有請求本文，也不把頁面文字、配裝或顯示偏好放入請求。API 回傳的 JSON 僅用來核對資料，不當作可執行程式碼。所有外掛程式碼均隨安裝封裝提供。

GamesLantern 伺服器仍可能收到一般 HTTP 連線資訊，例如 IP 位址、瀏覽器資訊及請求標頭。其伺服器紀錄、網站原有功能、圖片及廣告由該網站管理，不由本外掛控制。開發者沒有營運收取外掛使用者資料的伺服器。

## 資料用途與分享

上述資料只用於繁中顯示、原文切換與保存顯示偏好。本外掛沒有使用者行為統計、廣告追蹤或分析 SDK；不販售資料、不建立廣告或信用評估檔案，也不將頁面內容或設定分享給無關第三方。

本外掛依 Chrome Web Store 使用者資料政策及 Limited Use 要求，將資料用途限制於上述使用者功能。

## 保存期限與使用者控制

當前頁面的處理資料只存在該頁面的記憶體中；關閉或重新載入頁面後會重新建立。啟用與語言設定保存於瀏覽器本機，直到使用者變更設定或移除本外掛。可在頁面的控制列切回原文或停用翻譯，也可在 Chrome 擴充功能管理頁移除外掛及其本機設定。

## 聯絡與政策更新

如有隱私或資料處理問題，請使用本外掛 Chrome Web Store 項目所列的開發者聯絡方式。新版本若改變資料處理行為，會更新本頁的日期、適用版本及說明。

---

# Privacy Policy — English

Effective October 11, 2026 · Extension version 0.2.28

Darktide GamesLantern 繁中助手 displays Traditional Chinese game text and player-guide supplements on darktide.gameslantern.com. It is an independent community tool, unaffiliated with GamesLantern, Fatshark or Games Workshop.

## PoC validation and permissions

This tool is currently provided solely for proof-of-concept (PoC) validation. Permission to use the relevant materials is being sought. It is an independent community tool, unaffiliated with GamesLantern, Fatshark or Games Workshop, and does not imply official endorsement.

## On-device data

Chrome local storage retains only the enabled state and display language. Chrome sync storage is not used. The extension temporarily processes the current page path, native game-item text and icon URLs in memory to match its bundled translations. These values are not uploaded to the developer or an analytics service and are not persistently saved. Author-written guides and input areas are excluded from translation; their content is not saved or uploaded.

## Network requests

On pages requiring dataset verification, the extension makes at most one HTTPS GET per document to https://darktide.gameslantern.com/api/build-editor/initialize. It omits login cookies using `credentials:omit`, sends no request body, and does not include page text, builds or preferences in the request. The returned JSON is used as data, never executed as code. All executable extension code is included in the installation package.

The GamesLantern server may receive ordinary HTTP connection information such as the IP address, browser information and request headers. That website controls its own server logs, features, images and advertising. The extension publisher does not operate a server that receives extension users' data.

## Use and sharing

Data is used only to provide translated text, original-text restoration and display preferences. The extension has no behavioral analytics, advertising tracker or analytics SDK. Data is not sold, used for advertising or credit profiling, or shared with unrelated third parties. Use is limited to the stated user-facing features under the Chrome Web Store User Data Policy and Limited Use requirements.

## Retention and controls

Page-processing data remains in the document's memory and is recreated on navigation or reload. Local preferences remain until changed or the extension is removed. Users can restore the original language or disable translation using the page controls, or remove the extension and its local settings through Chrome's extension manager.

## Contact and updates

For privacy questions, use the developer contact information on this extension's Chrome Web Store listing. If a new release changes data practices, this policy's effective date, version and description will be updated.
