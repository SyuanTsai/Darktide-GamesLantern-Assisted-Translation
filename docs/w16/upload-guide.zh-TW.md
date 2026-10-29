# Chrome Web Store 上傳指南（W16）

本文供使用者或 Root 在確認既有 Chrome Web Store 項目後上傳 W16 ZIP。這是上傳作業指引，不代表商店欄位已填、已送審或已核准。

## 可交付候選

- 外掛版號：`0.2.32`
- ZIP：`darktide-gameslantern-zh-tw-0.2.32.zip`
- ZIP SHA-256：`cb79c83ca7c40a6fffdee4d272f0851632a862f74572053303e648bcb972d3ac`
- 封裝內容：W15 `1.13.2.3`，data revision `f182e7b4ba6fb04c9713ebada2cdbc8aabdd31d5b52b30a754e188ecc3fb5b2f`
- receipt：ZIP 同目錄的 `package-receipt.json`，只作內部來源與 bytes 核對，不上傳。
- 驗證：W16 production package suite `7 passed / 0 failed / 0 skipped`，包含 fresh-profile Chrome MV3 worker、ZIP 內離線 baseline 核對、Brain Rupture 列表與明細、鏈斧 Mk IV 的固定 DOM 驗證／原文還原，以及未映射 lasgun 保留原文。W11 DOM 回歸另為 `9 passed / 0 failed / 0 skipped`。
- Root 的去重 targeted verification `34 passed / 0 failed / 0 skipped` 與更新後 infantry-lasgun 負例 `1 passed / 0 failed / 0 skipped` 是控制列修正前的結果。修正後 focused production MV3 控制列回歸 `1 passed / 0 failed / 0 skipped`：在 `1280x900` 與 `390x844`，普通滑鼠點擊可切回原文及重新啟用，最高層覆蓋仍可見，且沒有 modal 或焦點陷阱；W11 content-entry 測試 `6 passed / 0 failed / 0 skipped`。
- 最終 ZIP 真站結果：Root 以本指南 SHA 的固定 ZIP 實測 Brain Rupture `/abilities` 頁，正向翻譯、普通滑鼠點擊切回原文與重新啟用均通過；六個固定公開 JSON GET 不帶 Cookie 或 Authorization。沒有 routing mock 或注入 test proof。真站技能明細與武器路徑先前 HTTP 403，未再重試；它們只有固定 DOM 的 MV3 測試結果，不能標示為真站驗收。
- 控制列修正後，Root 已重跑完整去重定向檢查：`34 passed / 0 failed / 0 skipped`，包含更新的普通點擊覆蓋測試與未知型號拒絕。

正式 Store item ID、目前已發布版號、開發者聯絡方式和 Dashboard 欄位值尚未在本指南固定。請從已驗證的既有 Store item 讀取這些欄位，不要建立新 item 或猜填。若既有 item 版號低於 `0.2.32`，可使用此 ZIP；若版號為 `0.2.32` 或更高，依下方命令重建一個高於 Dashboard 實際版號的候選。

## Listing 欄位草稿

以下文字與目前 package manifest、權限和 privacy policy 相符。把它映射到 Dashboard 現行欄位即可；本文不表示已選擇任何 Dashboard checkbox。

**名稱**

`Darktide GamesLantern 繁中助手`

**單一用途**

`在 GamesLantern 的支援頁面，為 Darktide 遊戲項目提供可切回原文的繁體中文顯示；無法驗證精確原生身分時保留原文。`

**簡短說明**

`使用已驗證的本機資料提供繁體中文顯示；只有精確原生身分符合時才替換頁面文字。`

**遠端程式碼**

`沒有遠端程式碼。JavaScript、CSS、圖示、W15 baseline 與 manifest 都隨 ZIP 封裝。外掛從固定 HTTPS 資料站讀取公開 JSON，回應只作資料，不作程式執行。`

## 權限與網站範圍說明

Manifest 的普通 `permissions` 為空陣列，沒有 optional permissions。請在 Dashboard 的權限理由欄保留兩種不同範圍：

**固定 data host permission**

`https://darktide.tw-syuan.com/*` 用於 GET `/version.json`、被選版號指向的 manifest 及其四個核心 JSON 資料域。請求沒有 request body、略過登入憑證並拒絕 redirect；此外掛不要求帳號或寫入網站資料。

**Content-script matches**

- `https://darktide.gameslantern.com/build-editor*`：支援 build-editor 內已觀察到的技能／祝福原生卡片與 tooltip。
- `https://darktide.gameslantern.com/abilities`：支援技能列表頁。
- `https://darktide.gameslantern.com/abilities/*`：支援技能明細頁。
- `https://darktide.gameslantern.com/weapon-blessing-traits*`：支援武器祝福特性頁。
- `https://darktide.gameslantern.com/weapons/*`：支援武器明細頁。

這些 match 僅允許 content script 在上述 GamesLantern 路徑讀取頁面原生結構並執行本機比對；它們不等同於 data host permission，也不擴及其他網站或所有網址。若 Dashboard 把 content-script 存取列為網站權限，按實際顯示如實說明。

## Privacy 欄位填寫依據

請使用 ZIP 內相同版本的 `PRIVACY.md`。預定公開 Privacy URL 為 [GitHub 上的 PRIVACY.md](https://github.com/SyuanTsai/Darktide-GamesLantern-Assisted-Translation/blob/main/PRIVACY.md)；上傳前須確認此正式 HTTPS 頁面可匿名讀取，且內容與 ZIP 內檔案一致。若頁面尚未合併或 URL 驗證失敗，先完成既有 repo 的正常合併並重新 GET 核對，不要填 branch、local path 或未驗證網址。開發者聯絡欄沿用既有 item 中已核實的聯絡方式；不要自行造 email 或 item ID。

如 Dashboard 詢問資料存取、處理與傳輸，依下列區分回答：

- **本機處理**：在指定頁面讀取頁面路徑與原生遊戲項目的可見名稱、描述、連結、patch 標籤及武器圖示 metadata，以本機精確比對。這是頁面／瀏覽活動資料的本機處理；不要因內容不離開裝置而寫成完全沒有處理。
- **外部傳輸**：外掛只向固定 data host 請求公開 JSON；不將頁面路徑、頁面文字、build、表單值或偏好放入 request body／URL，也不隨請求傳登入憑證。
- **本機保存**：封裝附帶固定 W15 baseline；已驗證的公開 snapshots 可存在 extension IndexedDB，供 active/previous snapshot 與 update check 使用。不使用 Chrome Sync、Chrome local storage 或網站帳號。
- **未使用項目**：無外掛帳號、表單提交、廣告或行為分析 SDK；沒有把頁面內容上傳給開發者或分析服務的功能。
- **一般連線資訊**：資料站可能看到 IP、請求時間、headers 和公開 JSON URL；GamesLantern 自己的網站請求依其網站政策處理。

若 Dashboard 把「本機處理」與「收集／傳輸」分開詢問，分別如實說明；不要勾選不處理頁面資料，也不要把一般伺服器連線 metadata 說成不存在。

## 實際上傳步驟

1. 在已核對的既有 Store item 中確認 item ID、目前版號、聯絡方式及 Privacy 欄位。若無法確認要更新哪個 item，先停止 Dashboard 操作，不建立另一個項目。
2. 比較目前版號與 `0.2.32`。若目前低於 `0.2.32`，使用本指南列出的候選 ZIP。若目前為 `0.2.32` 或更高，替換為高於實際版號的下一個有效版本。每次指定新的、尚不存在的輸出目錄：

   ```powershell
   npm run test:w16:package
   npm run package:w16:release -- --version 0.2.32 --output-dir <new-absolute-output-directory>
   ```

   `0.2.32` 是本次候選版號；程式只驗 Chrome manifest 版號格式，不會替你核實商店目前版號。
3. 上傳前用 `Get-FileHash <zip-path> -Algorithm SHA256` 核對候選 ZIP SHA。若有重建，以新 `package-receipt.json` 的版號、W15 identity、檔案 inventory 和 archive SHA 為準；不要沿用舊 receipt。
4. 在既有 item 的 Dashboard 選擇上傳 ZIP 功能，只選 `.zip`，不要上傳 unpacked 資料夾或 receipt。確認 Dashboard 讀到的 manifest 版號、權限、網站範圍與本文件一致；若出現額外權限或 ZIP 錯誤，先停止並記錄錯誤。
5. 將實際 item ID、上傳版號、檔案 SHA、上傳／處理狀態與 Dashboard 顯示的 review state 記入交付紀錄。只有 Dashboard 顯示成功處理才可稱已上傳；只有實際狀態更新才可稱已送審或已核准。

## 重要功能限制

正式包不含 W11 測試用 proof registry；它以已驗證的 W15 資料集逐項比對原生名稱、描述、路徑與武器圖示，只翻譯唯一精確匹配。真站目前已驗證 Brain Rupture `/abilities` 頁；技能詳細頁與武器路徑因 HTTP 403 尚無 live 結果。固定 DOM MV3 測試通過不等於這些 live route 已驗收，也不能宣稱 GamesLantern 整站版本等於 W15 資料版本。未知或漂移項目仍保留原文；不得把 test proof 加入商店 ZIP。
