# SYP-389 spec1 實作計畫

## 目標與範圍
將 W10 資料層改成 Source-Data 1.0.0：current 與四分類整組驗證、保存與傳遞，不修改顯示層。來源為 1396e47 六份 schema 與 Web origin/main 固定路徑契約。前輪 fixture 保留並比對來源。

## 變更
1. 新增手寫 source-data-contract，逐條驗證六份 schema 與安全字串、跨檔一致性；loader 改成固定 URL、fatal UTF-8、上限、逾時與本機摘要。
2. snapshot-store 使用新資料庫、單一 scope，保留 staging、generation/CAS、active/previous；讀取複驗 bytes、identity、digest。舊資料庫不遷移也不刪除。
3. coordinator 移除 trusted identity 與 baseline，6h 成功間隔、既有退避、手動與 in-flight 合併。worker/client 改傳 raw bytes 並複驗；session 固定首次解析結果。
4. 建置清單切換新契約，移除 baseline 與 W09 candidate 驗證；保留 spec2 顯示相依模組及既有 production pin。ZIP 使用 pwsh。

## 測試與交付
採 TDD：先執行前輪契約測試，已因缺新模組失敗；再新增拒絕案例及 loader/store/coordinator/message/session 測試，確認 Red 後實作至 Green。整合使用本機 HTTP、瀏覽器 IndexedDB/MV3，禁止線上請求。驗證建置、W11/W16 既有測試並記錄 spec2 相容性差異。更新文件與 package scripts，確認 runtime/build 無舊路徑及 baseline 引用，正常 commit hooks、不 push。

## 風險與復原
新資料庫隔離舊格式；任何驗證/下載失敗保持原 active，再 previous，最後原文。CAS 防過期工作啟用。摘要只偵測本機損毀，不提供遠端信任。spec2 前顯示 consumer 仍預期舊格式，因此本輪僅保證資料層；不新增 approval/review 欄位。可藉由還原本次 commit 回復程式，舊資料庫完整保留。
