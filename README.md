# IsRight 工具箱

教學與生活小工具的整合入口，以 GitHub Pages 發布。

| 路徑 | 工具 | 備註 |
|---|---|---|
| `question-variant/` | 題目變形工坊 | 純前端 |
| `exam-to-word/` | 考卷轉 Word | 純前端，Markdown＋LaTeX 轉 docx |
| `roll-call/` | 點名表產生器 | 純前端 |
| `igp/` | IGP 產生器 | 純前端，資料只在瀏覽器處理 |
| `escape-room/` | 數位密室逃脫（學生端／`teacher.html` 教師監看台） | 後端為 Google Apps Script，不在本 repo |
| `grab-launcher/` | 搶登記發射台 | 純前端 |
| `key-path/` | 鍵盤路徑勘查 | 純前端 |

## 個資原則

本 repo **不放任何學生資料**：IGP 文件、設定檔（含學生姓名）、簽到表、後端程式與金鑰都只留在本機。
`.gitignore` 已排除常見的資料檔格式，新增檔案前請再確認。

## 新增工具

1. 建一個英文資料夾，把工具的 HTML 命名為 `index.html` 放進去。
2. 在根目錄 `index.html` 加一張卡片。
3. commit、push，約一分鐘後網站更新。
