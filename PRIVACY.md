# Darktide GamesLantern 繁中助手｜隱私政策

生效日期：2026 年 10 月 28 日

這個獨立社群外掛只在 `darktide.gameslantern.com` 的指定技能、祝福、武器與 build-editor 路徑提供可切回原文的繁體中文顯示。它與 GamesLantern、Fatshark 及 Games Workshop 無官方關係，也不表示已獲官方背書。

## 頁面資料如何處理

在支援的頁面中，外掛會於瀏覽器本機讀取目前頁面路徑，以及比對原生遊戲項目所需的可見名稱、描述、連結、選取的 patch 標籤和武器圖示資訊。這些內容用於核對本機資料中的精確對應項目；找不到唯一且已驗證的對應時，外掛保留原文。表單、可編輯欄位、build/guide prose 和任意使用者輸入不作為翻譯來源。

頁面路徑與原生頁面內容只在瀏覽器的外掛元件間傳遞及短暫處理，不放入外部網路請求，也不由外掛傳送給開發者、GamesLantern 或分析服務。停用或切回原文會依頁面控制器還原原生文字。

## 網路連線

外掛只從固定 HTTPS 資料站 `https://darktide.tw-syuan.com` 讀取公開 JSON：`/version.json`、版本指向的 manifest，以及 manifest 指定的四個核心資料域。依快取、驗證狀態或使用者觸發的更新檢查，可能重新請求這些檔案。請求使用 GET、沒有 request body、略過登入憑證（`credentials: omit`）並拒絕重新導向。外掛會核對來源、回應格式、檔案大小及固定雜湊；回應只作資料使用，不作程式碼執行。

GamesLantern 頁面本身仍由瀏覽器直接載入，並可能依該網站自己的設計請求圖片或其他資源；這些網站連線不由外掛資料載入器管理。資料站會收到一般 HTTP 連線中繼資料，例如 IP 位址、時間、瀏覽器請求標頭與所請求的公開 URL。GamesLantern 也可能依使用者直接瀏覽網站的方式收到該網站自己的連線資訊。各站的伺服器記錄與保存方式依各站政策處理。

## 本機儲存與保留

外掛封裝內含一份已固定雜湊的 W15 公開資料基線，作為本機驗證及離線回復來源。下載並驗證的公開資料快照可存於瀏覽器 IndexedDB，供目前版本、前一個已驗證版本與更新檢查使用；外掛不使用 Chrome Sync、Chrome local storage 或網站帳號來保存這些資料。頁面文字與使用者輸入不寫入 IndexedDB。啟用／停用意圖只在目前文件的記憶體中維持，不建立跨頁個人偏好檔。

瀏覽器會管理擴充功能 IndexedDB 的可用空間及生命週期。使用者可在頁面控制列切回原文或停用，也可在 Chrome 擴充功能管理頁停用或移除外掛。移除後的本機資料清理由瀏覽器管理。

## 分享、追蹤與聯絡

外掛沒有廣告、行為分析 SDK、使用者帳號、表單提交或頁面內容上傳功能，也不販售或分享外掛取得的頁面內容。這項說明不涵蓋使用者直接瀏覽 GamesLantern 時該網站自己的資料處理。

隱私問題可透過外掛正式發佈頁提供的開發者聯絡方式提出。若未來版本改變資料處理方式，將更新本政策與生效日期。

---

# Privacy Policy — English

Effective date: October 28, 2026

Darktide GamesLantern Traditional Chinese Assistant is an independent community extension. It provides reversible Traditional Chinese display on specified skill, blessing, weapon, and build-editor routes on `darktide.gameslantern.com`. It is not affiliated with or endorsed by GamesLantern, Fatshark, or Games Workshop.

## Page data processed on your device

On supported pages, the extension reads the current page path and the visible native fields needed to identify a game item, such as its name, description, link, selected patch label, and weapon image metadata. It uses these values locally to find an exact match in the verified data. If there is no unique verified match, the original text remains. Forms, editable fields, build or guide prose, and arbitrary user input are not translation sources.

The page path and native page values are handled in the browser by the extension's components. They are not included in external network requests or sent by the extension to the developer, GamesLantern, or an analytics service. Disabling the extension or switching back to the original text restores the native text through the page controls.

## Network requests

The extension reads public JSON only from the fixed HTTPS data site `https://darktide.tw-syuan.com`: `/version.json`, the manifest selected by that version file, and the four core data domains declared by the manifest. Depending on cache and verification state or a user-triggered update check, it may request these files again. Requests use GET with no request body, omit login credentials (`credentials: omit`), and reject redirects. The extension verifies the origin, response format, file size, and fixed hashes; responses are treated as data, never executable code.

The browser loads GamesLantern pages directly. That site may request images or other resources according to its own design; those requests are not made by the extension's data loader. The data site receives ordinary HTTP connection metadata such as an IP address, request time, browser headers, and the public URL requested. GamesLantern may receive its own connection information when a user visits its site directly. Each site controls its own server logs and retention under its policies.

## Local storage and retention

The extension package includes a W15 public-data baseline with fixed hashes for local verification and offline recovery. Downloaded, verified public snapshots may be stored in browser IndexedDB for the active version, the previous verified version, and update checks. The extension does not use Chrome Sync, Chrome local storage, or a website account for these snapshots. Page text and user input are not written to IndexedDB. The enabled or disabled intent is kept in memory for the current document and is not saved as a cross-page preference profile.

The browser manages the storage quota and lifecycle for extension IndexedDB. Users can restore the original text or disable the extension using the page controls, or disable or remove it in Chrome's extension manager. The browser manages local-data cleanup after removal.

## Sharing, tracking, and contact

The extension has no advertising, behavioral analytics SDK, user account, form submission, or page-content upload feature. It does not sell or share page content processed by the extension. This statement does not cover the site's own data practices when a user browses GamesLantern directly.

Privacy questions may be sent through the developer contact method shown on the extension's official distribution page. If a future version changes these data practices, this policy and its effective date will be updated.
