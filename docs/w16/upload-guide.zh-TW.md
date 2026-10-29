# Chrome Web Store 上傳指南（W16）

本文供使用者或 Root 在確認既有 Chrome Web Store 項目後上傳 W16 ZIP。這是上傳作業指引，不代表商店欄位已填、已送審或已核准。

## 可交付候選

- 外掛版號：`0.2.33`
- ZIP：`F:\GitFile\Persion - Games\DarkTide-Web\.tmp\w16-startup-20261028\a02\upload-kit-0.2.33-ready\darktide-gameslantern-zh-tw-0.2.33.zip`
- ZIP SHA-256：`2dfaa04cc3d6f2420855a49a1ac9dc49b5cdc2ef1f7115eb17d78966b7da77f9`
- 封裝內容：W15 `1.13.2.3`，data revision `f182e7b4ba6fb04c9713ebada2cdbc8aabdd31d5b52b30a754e188ecc3fb5b2f`
- receipt：ZIP 同目錄的 `package-receipt.json`，只作內部來源與 bytes 核對，不上傳。
- A01 歷史驗證：production package suite `7 passed / 0 failed / 0 skipped`，W11 DOM 回歸 `9 passed / 0 failed / 0 skipped`；這些是 `0.2.32` 的結果。
- A02 Unit `10 passed / 0 failed / 0 skipped`；正常 production package 與 W11 MV3 reader 回歸各 `1 passed / 0 failed / 0 skipped`。W11 reader 測試以固定候選技能卡和 test-only proof 讓原本的 ready 條件成立；這不表示原生祝福項目已被識別，proof 也未放入正式 ZIP。
- 最終去重 targeted suite：`38 passed / 0 failed / 0 skipped`。包含最高層覆蓋仍可見時，在 `1280x900` 與 `390x844` 普通點擊 LV1/LV4、切回原文與重新啟用；閱讀器位於右下控制面板的非模態 popover 內，面板可捲動且不溢出。
- Root 由 clean index 重建後核對封裝內 `30/30` 檔案與工作樹內容逐 byte 相同。
- 最終 ZIP 真站結果：此 SHA 的 ZIP 在 `/weapon-blessing-traits` HTTPS 頁面通過普通 LV1/LV4 操作、切回原文與重新啟用，native 狀態保持 original；六個固定公開 JSON GET 不帶 Cookie 或 Authorization，沒有 routing mock、test proof 或 extension error。真站閱讀器在右下控制面板內，桌面與 390px 版面均可用；兩種寬度都能展開並捲讀既有「條件」說明。本次快照沒有術語區，這次真站驗證不代表已驗過五節或術語。
- 本次 ZIP 的 `/abilities` 請求被 HTTP 403 阻擋；detail 與 weapon 路徑未重試。較早 A01 `/abilities` 正向結果只適用於歷史 ZIP `0.2.32`。detail／weapon 正向結果仍是固定 DOM 的 MV3 驗證，不能標示為本次真站驗收。
- 先前 A02 候選 `c9a183f2…` 曾在 390px 被廣告覆蓋攔截普通按鈕操作，已由本 SHA 取代，不要上傳舊 ZIP。

正式 Store item ID、目前已發布版號、開發者聯絡方式和 Dashboard 欄位值尚未在本指南固定。請從已驗證的既有 Store item 讀取這些欄位，不要建立新 item 或猜填。若既有 item 版號低於 `0.2.33`，可使用 Root 最終收據中記載的 ZIP；若版號為 `0.2.33` 或更高，依下方命令重建一個高於 Dashboard 實際版號的候選。

## Listing 欄位草稿

以下文字與目前 package manifest、權限和 privacy policy 相符。把它映射到 Dashboard 現行欄位即可；本文不表示已選擇任何 Dashboard checkbox。

**名稱**

`Darktide GamesLantern 繁中助手`

**單一用途**

`在 GamesLantern 的支援頁面，為 Darktide 遊戲項目提供可切回原文的繁體中文顯示；無法驗證精確原生身分時保留原文。`

**簡短說明**

`使用已驗證的本機資料提供繁體中文顯示；只有精確原生身分符合時才替換頁面文字。`

此外，既有 `/weapon-blessing-traits` 頁面的右下控制面板內提供可捲動的獨立本機祝福參考閱讀器。它允許使用者選擇祝福、變體與階級，並明示本機資料版本；它不表示該頁原生祝福、變體或適用階級已完成身分驗證或翻譯。

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
2. 比較目前版號與 `0.2.33`。若目前低於 `0.2.33`，使用 Root 最終收據列出的候選 ZIP。若目前為 `0.2.33` 或更高，替換為高於實際版號的下一個有效版本。每次指定新的、尚不存在的輸出目錄：

   ```powershell
   npm run test:w16:package
   npm run package:w16:release -- --version 0.2.33 --output-dir <new-absolute-output-directory>
   ```

   `0.2.33` 是本次候選版號；程式只驗 Chrome manifest 版號格式，不會替你核實商店目前版號。
3. 上傳前用 `Get-FileHash <zip-path> -Algorithm SHA256` 核對候選 ZIP SHA。若有重建，以新 `package-receipt.json` 的版號、W15 identity、檔案 inventory 和 archive SHA 為準；不要沿用舊 receipt。
4. 在既有 item 的 Dashboard 選擇上傳 ZIP 功能，只選 `.zip`，不要上傳 unpacked 資料夾或 receipt。確認 Dashboard 讀到的 manifest 版號、權限、網站範圍與本文件一致；若出現額外權限或 ZIP 錯誤，先停止並記錄錯誤。
5. 將實際 item ID、上傳版號、檔案 SHA、上傳／處理狀態與 Dashboard 顯示的 review state 記入交付紀錄。只有 Dashboard 顯示成功處理才可稱已上傳；只有實際狀態更新才可稱已送審或已核准。

## 重要功能限制

正式包不含 W11 測試用 proof registry；它以已驗證的 W15 資料集逐項比對原生名稱、描述、路徑與武器圖示，只翻譯唯一精確匹配。A02 增加的祝福閱讀器只是本機資料參考：右下控制面板會顯示本機資料版號，並說明尚未驗證此頁原生祝福或階級適用性；它不會建立原生翻譯記錄。此 SHA 的真站祝福閱讀器已驗證；本次 `/abilities` 被 HTTP 403 阻擋，detail 與 weapon 路徑未測。較早 A01 `/abilities` 正向證據只屬於 `0.2.32` ZIP。固定 DOM MV3 測試通過不等於其他 live route 已驗收，也不能宣稱 GamesLantern 整站版本等於 W15 資料版本。未知或漂移項目仍保留原文；不得把 test proof 加入商店 ZIP。
