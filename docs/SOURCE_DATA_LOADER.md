# Source-Data 載入器

W10 固定讀取 `https://darktide.tw-syuan.com/source-data/current.json`，再依已驗證的 `gameVersion` 組成 `/source-data/<gameVersion>/{skills,weapons,blessings,terms}.json`。版本支援兩到四段數字；不接受資料指定任意下載 URL。dev 建置固定使用 preview origin。

契約依 DarkTide-Source-Data `1396e47` 的六份 schema 手寫驗證，包含必填、額外欄位、條件規則及巢狀 values。另檢查四欄識別（schemaVersion、gameVersion、sourceCommit、textBatch）、分類、current.path／versions、唯一 id 與分類前綴；拒絕可執行內容、危險鍵、BOM 與無效 UTF-8。任一檔案不符即拒絕整組。null 文字原樣保留，沒有 approval／review 條件。

所有 fetch 使用 `cache: 'no-cache'`、CORS、省略 credentials、拒絕 redirect，檢查最終 URL 及 JSON MIME。current 上限 64 KiB、單檔 32 MiB、整組 64 MiB；每次 fetchCurrent／downloadSnapshot 操作逾時 30 秒。

快照存於新 IndexedDB `darktide-w10-source-data-snapshots-v1` 的單一 `source-data` scope，以 gameVersion＋sourceCommit＋textBatch＋本機 raw bytes SHA-256 作鍵。摘要採固定分類順序與長度框定，只用於偵測本機損毀，沒有遠端 SHA 釘選。讀取時重新驗證 bytes、identity、digest；staging 與 generation／CAS 保護整組原子啟用。舊資料庫不讀寫也不刪除。

回退順序為 active → previous → 保留原文，沒有包內 baseline。成功後 6 小時再檢查；失敗依 5 分鐘、30 分鐘、2 小時、6 小時退避（之後維持 6 小時）。手動檢查可略過等待，同時要求合併。current 的四欄識別與有效 active 相同時只抓 current，不重抓分類。

worker 經受保護訊息傳送 base64 raw bytes 與 identity；client 重新驗證整組與 identity。一文件固定首次解析結果，手動檢查不熱換快照。

## 顯示層（spec2）

`view-model.js`／`presentation.js` 直接投影快照的四份 `documents`，沒有中介領域 records 或 split 合併。正式與 dev 建置使用相同 runtime 清單及依賴順序；正式包不再寫入固定遊戲版本的 dataset pin。可信 identity 來自 spec1 client 已驗證的 `schemaVersion`、`gameVersion`、`sourceCommit`、`textBatch`，一文件固定首次快照。UI 顯示 `gameVersion／sourceCommit 前 7 碼／textBatch`，包含獨立祝福閱讀器的來源註記。

比對時，直接觀察的 `gameslanternId` 若符合 `aliases.gameslantern.ids`，優先於原文 fallback；同一強鍵對應多筆就不套用。沒有可觀察 id 時沿用技能英文名＋完整英文描述、祝福英文名＋描述＋等級，以及武器 route／title／鏡像 title／圖片的既有精確檢查。比對不到保留原文，不從 slug 推測內部 id。祝福的武器 context 必須同時提供 family 與 mark，並以 `values.weapons[]` 精確連到武器 id。

目前技能列表、技能詳細頁、build-editor tooltip 與武器詳細頁的既有 observation 都沒有可核實的 GamesLantern 內部 id；技能連結 path 和武器 route 可以觀察，但不能冒充 `ids`。因此強鍵暫時只用在明確提供 `gameslanternId` 的 observation／slot 介面與測試；現有頁面實際仍走上述 fallback。武器若提供 `aliases.gameslantern.path`，用其精確比對 route，仍同時要求英文 title（完整名稱或既有 mark＋名稱形狀）、鏡像 title 與圖片檢查；path 不單獨作強鍵，也不從內部 family／mark 推測英文型號。祝福頁維持獨立閱讀器，不聲稱已驗證該頁原生祝福或階級。沒有擴大權限或注入頁面 script。

名稱 `name.zh` 或描述 `official.zh` 為 null、空白，或含 `{`、`}`、`<`、`>` 時，該欄位不覆寫；其他安全欄位與詳細說明仍可顯示。`name.origin === 'glossary'` 的名稱與術語標籤加上「（非官方譯名）」。說明按「效果／條件／計算／補充／額外」排序，空白節隱藏。術語由 `terms.items[].values.refs[]` 反查，保留 id 與 `values.context`，同名不同 context 不混併，定義取 `explanation.effect`。

祝福閱讀器顯示 `official.zh` 原文、說明五節與「等級 × 數值」表，不產生舊的每級文案。表格依 `values.tiers[].tier` 及各級 params 顯示；unknown 一律為「原始碼未公開」。適用武器列出關聯的武器名稱與 mark。武器按 family 分組，可切換 mark，顯示名稱、官方描述、五節說明、`values.bars[]` 各 stat 的 min～max、`values.actions[]`，以及由 `values.blessings[]` 連到的祝福名稱。

`projectWeaponCurves(item)` 與 `projectWeaponAttackCombos(item)` 在 schema 1.0.0 固定回 null，待 WP2 格式定案後接入。DOM 只接受非空陣列：曲線形狀為 `[{label,inputUnit,outputUnit,knots:[{input,output}]}]`，保留「來源曲線節點：輸入 X，輸出 Y」文字；連段形狀為 `[{label,steps:[{label,kind}]}]`。null／空陣列完全隱藏區塊，不以 bars min/max 推算曲線。

勘誤只顯示 `locale === 'zh'`，在獨立「勘誤」區塊保留 official、corrected 與 valueRef。`locateErratum(text, erratum)` 固定回 null，待 WP3 提供精確子字串與出現次序欄位後接入，目前不搜尋字串或猜測定位。所有資料以 `textContent`／文字節點輸出；切回原文、patch label 改變、四欄 identity 任一變更或原生 slot 身分變更時，保留既有還原及停止機制。

## 驗證與歷史測試

`npm run test:source-data` 以 `node --test --test-concurrency=1` 執行 W10／W11／W16 所有測試。顯示 fixture 由 `tests/helpers/source-data-display.cjs` 在記憶體產生，並通過完整 schema 契約驗證。DOM 單元測試不依賴瀏覽器；DOM／MV3／IndexedDB 整合測試只使用既有本機 Playwright 與 Chromium，缺少時標示 skip，不下載。瀏覽器測試以本機 fixture 回應／封鎖網路，不存取線上網站。

舊 W10 領域 helper、舊顯示 presentation 測試與 split fixture 已由新格式測試取代，直接相依的 W13 遠程武器測試也改驗證新 bars／actions。W01／W02 是獨立早期實驗與契約驗證流程，並非本顯示 runtime 或建置依賴；其中刻意使用的歷史版本號屬 fixture，不是選版 pin。全域文字掃描仍會找到 W02 固定 owner-snapshot 的 authoring 欄位名稱（含官方輸入摘要）；這是歷史契約驗證，不是顯示層的舊資料依賴，保留其原契約測試。
