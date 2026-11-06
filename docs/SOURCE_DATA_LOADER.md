# Source-Data 載入器

W10 固定讀取 `https://darktide.tw-syuan.com/source-data/current.json`，再依已驗證的 `gameVersion` 組成 `/source-data/<gameVersion>/{skills,weapons,blessings,terms}.json`。版本支援兩到四段數字；不接受資料指定任意下載 URL。dev 建置固定使用 preview origin。

契約依 DarkTide-Source-Data `1396e47` 的六份 schema 手寫驗證，包含必填、額外欄位、條件規則及巢狀 values。另檢查四欄識別（schemaVersion、gameVersion、sourceCommit、textBatch）、分類、current.path／versions、唯一 id 與分類前綴；拒絕可執行內容、危險鍵、BOM 與無效 UTF-8。任一檔案不符即拒絕整組。null 文字原樣保留，沒有 approval／review 條件。

所有 fetch 使用 `cache: 'no-cache'`、CORS、省略 credentials、拒絕 redirect，檢查最終 URL 及 JSON MIME。current 上限 64 KiB、單檔 32 MiB、整組 64 MiB；每次 fetchCurrent／downloadSnapshot 操作逾時 30 秒。

快照存於新 IndexedDB `darktide-w10-source-data-snapshots-v1` 的單一 `source-data` scope，以 gameVersion＋sourceCommit＋textBatch＋本機 raw bytes SHA-256 作鍵。摘要採固定分類順序與長度框定，只用於偵測本機損毀，沒有遠端 SHA 釘選。讀取時重新驗證 bytes、identity、digest；staging 與 generation／CAS 保護整組原子啟用。舊資料庫不讀寫也不刪除。

回退順序為 active → previous → 保留原文，沒有包內 baseline。成功後 6 小時再檢查；失敗依 5 分鐘、30 分鐘、2 小時、6 小時退避（之後維持 6 小時）。手動檢查可略過等待，同時要求合併。current 的四欄識別與有效 active 相同時只抓 current，不重抓分類。

worker 經受保護訊息傳送 base64 raw bytes 與 identity；client 重新驗證整組與 identity。一文件固定首次解析結果，手動檢查不熱換快照。顯示層對新 items 的映射、null 不覆寫與 W16 production pin 移除留給 spec2；目前 production pin 僅保留在顯示 consumer，不能控制 W10 選版。
