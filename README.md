# Paper Knowledge Graph / 论文知识图谱

一个本地优先、无需数据库的论文阅读与分类工具。它把文件夹目录视为关键词分类，将关键词与论文以两列关系图谱展示，并提供阅读状态、摘要、星级、关键词编辑、本地 PDF 打开和目录同步功能。

> 隐私优先：论文、摘要和图片默认只保存在你的电脑上。仓库不包含任何论文 PDF。

## 功能亮点

- **目录即分类**：`library/` 下的文件夹名就是关键词；嵌套目录会自然形成多关键词分类。
- **分层图谱**：左侧关键词、右侧论文，长标题自动换行显示。
- **阅读管理**：摘要保存后自动标记为已读；支持 1–5 星重要度。
- **富文本摘要**：加粗、斜体、下划线、列表、撤销/重做、粘贴或插入图片。
- **本地 PDF**：点击论文标题，通过系统默认 PDF 阅读器打开本地文件。
- **安全同步**：一键发现新增 PDF、同步移动路径，并清理已经删除的论文记录。
- **可编辑**：新增关键词、修改论文关键词；右键论文节点可同步修改标题和本地文件名。
- **离线可用**：前端无第三方 CDN、无遥测、无云端数据库。

## 截图与示例数据

仓库的 `dist/papers.example.json` 附带 4 条公开论文元数据示例，仅用于展示界面。示例不包含 PDF 文件，路径均为仓库内 `library/` 的相对路径，不含任何真实用户信息。首次启动会把它复制为不受 Git 跟踪的 `dist/papers.json`。

首次执行“一键更新”后，示例记录会被没有对应 PDF 的真实目录扫描结果替换或清理。

## 快速开始（Windows）

### 方式一：双击启动

1. 克隆或下载本仓库。
2. 解压后直接双击仓库根目录中的 `PaperGraph.exe`，程序会自动启动本地服务并在浏览器中打开论文知识图谱。
3. 将 PDF 按主题放入 `library/`，例如：

   ```text
   library/
   ├── In-Context Learning/
   │   ├── Calibration/
   │   │   └── example-a.pdf
   │   └── example-b.pdf
   └── Retrieval-Augmented Generation/
       └── example-c.pdf
   ```

4. 点击页面顶部的“一键更新”。

如果 `PaperGraph.exe` 缺失，开发者也可以双击 `start.cmd`；脚本会先使用 `build.ps1` 编译启动器，再运行程序。

系统要求：Windows 10/11、.NET Framework 4.x、现代浏览器。

### 方式二：仅预览前端

任何静态 HTTP 服务器都可以展示示例数据：

```bash
copy dist\papers.example.json dist\papers.json
python -m http.server 8000 --directory dist
```

然后访问 `http://127.0.0.1:8000/`。纯静态服务器只能浏览示例图谱；打开本地 PDF、上传摘要图片、重命名文件和一键更新需要 Windows 启动器。

## 生成更丰富的目录元数据

可选的 Python 工具会读取 PDF 元数据，并为已经带有已读标记的文件尝试提取简短摘要：

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python tools\build_catalog.py
```

识别为已读的文件名标记包括：`✅`、`√`、`读完`、`概述`。

## 数据与存储

| 内容 | 默认位置 | 是否进入 Git |
| --- | --- | --- |
| 论文 PDF | `library/**/*.pdf` | 否 |
| 示例论文目录 | `dist/papers.example.json` | 是，仅 4 条公开示例 |
| 真实论文目录 | `dist/papers.json` | 否，默认被忽略 |
| 阅读摘要、星级、手动关键词 | 浏览器 `localStorage` | 否 |
| 摘要图片 | `dist/user-assets/` | 否 |

`papers.json` 的核心结构：

```json
{
  "papers": [
    {
      "id": "p1",
      "title": "Example Paper",
      "filename": "Example Paper.pdf",
      "year": "2026",
      "venue": "Example Venue",
      "taxonomy": ["Topic", "Subtopic"],
      "keywords": ["Topic", "Subtopic"],
      "read": false,
      "summary": "",
      "path": "library\\Topic\\Subtopic\\Example Paper.pdf",
      "sizeMB": 0
    }
  ]
}
```

## 隐私与安全设计

- 本地服务器只监听 `127.0.0.1`，不会向局域网公开。
- PDF 打开、重命名与扫描都限制在仓库的 `library/` 目录内。
- 上传的摘要图片限制为 PNG、JPEG、GIF 或 WebP，单张不超过 10 MB。
- 重命名会拒绝非法字符、Windows 保留文件名、过长路径和同名覆盖。
- 请勿把个人论文库、真实 `papers.json` 或 `dist/user-assets/` 提交到公共仓库。仓库仅保留可公开分发的 `PaperGraph.exe`，其他 EXE 默认被 `.gitignore` 排除。

## 项目结构

```text
.
├── dist/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── papers.example.json
├── library/                 # 本地论文目录（PDF 被 Git 忽略）
├── tools/
│   ├── PaperGraphLauncher.cs
│   └── build_catalog.py
├── PaperGraph.exe           # Windows 双击启动器
├── build.ps1
├── start.cmd
├── requirements.txt
└── LICENSE
```

## 开发与验证

```powershell
# JavaScript 语法
node --check dist\app.js

# 编译本地启动器
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

项目使用原生 HTML、CSS 和 JavaScript，无前端构建步骤。

## 路线图

- 导入/导出阅读数据；
- 可选的 SQLite 持久化；
- 跨平台本地启动器；
- 更多富文本编辑能力；
- 可配置的主题和布局。

## 贡献

欢迎提交 Issue 和 Pull Request。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，并确保提交内容不含论文 PDF、私人路径或个人阅读数据。

## License

[MIT](LICENSE)

