# Chrome Web Store 上傳指南（W16）

本文供使用者或 Root 在確認既有 Chrome Web Store 項目後上傳 W16 ZIP。這是上傳作業指引，不代表商店欄位已填、已送審或已核准。

## 可交付候選

- 外掛版號：`0.2.31`
- ZIP：`darktide-gameslantern-zh-tw-0.2.31.zip`
- ZIP SHA-256：`e1b9f985b3c35d8c2ac176baf76fae1eaa3b9c6c751e0e50abbbdbb5666d3cda`
- 封裝內容：W15 `1.13.2.3`，data revision `f182e7b4ba6fb04c9713ebada2cdbc8aabdd31d5b52b30a754e188ecc3fb5b2f`
- receipt：ZIP 同目錄的 `package-receipt.json`，只作內部來源與 bytes 核對，不上傳。
- 驗證：W16 production package suite `5 passed / 0 failed / 0 skipped`，包含 fresh-profile Chrome MV3 worker、ZIP 內離線 baseline 核對及未知 native identity 保留原文。

正式 Store item ID、目前已發布版號、開發者聯絡方式和 Dashboard 欄位值尚未在本指南固定。請從已驗證的既有 Store item 讀取這些欄位，不要建立新 item 或猜填。若既有 item 版號低於 `0.2.31`，可使用此 ZIP；若版號為 `0.2.31` 或更高，依下方命令重建一個高於 Dashboard 實際版號的候選。

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
2. 比較目前版號與 `0.2.31`。若目前低於 `0.2.31`，使用本指南列出的候選 ZIP。若目前為 `0.2.31`，例如用以下命令產生 `0.2.32`；若目前更高，替換為高於實際版號的下一個有效版本。每次指定新的、尚不存在的輸出目錄：

   ```powershell
   npm run test:w16:package
   npm run package:w16:release -- --version 0.2.32 --output-dir <new-absolute-output-directory>
   ```

   `0.2.32` 僅是 Store 顯示目前版號恰為 `0.2.31` 時的例子；其他目前版號要相應遞增。程式只驗 Chrome manifest 版號格式，不會替你核實商店目前版號。
3. 上傳前用 `Get-FileHash <zip-path> -Algorithm SHA256` 核對候選 ZIP SHA。若有重建，以新 `package-receipt.json` 的版號、W15 identity、檔案 inventory 和 archive SHA 為準；不要沿用舊 receipt。
4. 在既有 item 的 Dashboard 選擇上傳 ZIP 功能，只選 `.zip`，不要上傳 unpacked 資料夾或 receipt。確認 Dashboard 讀到的 manifest 版號、權限、網站範圍與本文件一致；若出現額外權限或 ZIP 錯誤，先停止並記錄錯誤。
5. 將實際 item ID、上傳版號、檔案 SHA、上傳／處理狀態與 Dashboard 顯示的 review state 記入交付紀錄。只有 Dashboard 顯示成功處理才可稱已上傳；只有實際狀態更新才可稱已送審或已核准。

## 重要功能限制

此包的 production native-proof registry 目前為空。W16 測試證明固定 W15 baseline 可離線讀取、ZIP 可在 Chrome 啟動 MV3 worker，且未知 native identity 會保留原文；它沒有證明任何真實 GamesLantern 技能或武器可以正向匹配並翻譯。不要把這個包或測試結果描述為完整翻譯功能已在真站驗收。未來若補上正式 native proof，仍須依現有完整性與 identity guard 驗證，不能把 test proof 加入商店 ZIP。
