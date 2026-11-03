# Changelog

## [Unreleased]

### Added

- **M2（选区替换与判定完善）**
  - 选区替换：选中文字作为"描述"，生成后直接替换选区（`Cmd+Z` 可撤销）；整行/多行选区默认行间，句中短语默认行内
  - 数学判定重构：新增 `src/mathScan.ts` 纯函数扫描器，支持 `$...$`、`$$...$$`、`\[...\]`、`\(...\)`、数学环境白名单（`figure/table/document` 不误判）、`align*` 等星号变体
  - 过滤 LaTeX `%` 注释、`\verb`/verbatim 环境、Markdown 围栏代码块/行内代码/HTML 注释
  - `\$` 转义、金额 `$100`、未闭合 `$x + `、空行复位等启发式；扫描窗口向后多取 200 行以寻找行内公式闭合 `$`
  - 强制命令 `Agent Complete: 生成行内公式` / `生成行间公式` 接入并补充状态栏提示
  - 纯函数单测：`tests/`（`npm test`）；review 后补的回归用例覆盖 `\$` 结尾、未闭合围栏、`\(...\)` 归一、掩码顺序、金额+CJK、LaTeX 空格、`align*` 配对

- **M1（公式生成最小闭环）**
  - `Cmd+E` 触发：采集光标前文/后文（默认 32k token 预算）→ DeepSeek Chat Completions → 后处理 → ghost text
  - 基础行内/行间/数学环境判定（`$...$`、`$$...$$`、`equation/align` 等环境）
  - 思考强度可配，默认 `max`；状态栏显示生成中与耗时；输出面板记录耗时/上下文/usage
  - 文件排除 glob、API key 存 SecretStorage、超时与错误提示
  - `scripts/smoke.mjs`：真实 API 冒烟测试

### Changed

- 项目主场景从"Copilot 式代码补全"调整为"文字描述 → LaTeX 公式生成"

### Fixed

- 扩展宿主内 `fetch failed`：网络层改用 Node `https.request`，**始终跟随本机代理**（`agentComplete.proxy` → `http.proxy` → 环境变量 → macOS 系统代理），不自行直连；只有本机未配置代理时才直连。SOCKS 统一用 `socks5h` 由代理解析域名，多个代理候选依次尝试。错误信息带 cause 码与代理来源。
- 新增 `Agent Complete: 网络诊断` 命令：打印代理来源并实测 API 连通性。

## [M0] - 2026-11-04

### Added

- 仓库、计划文档（PLAN.md / DEV-PLAN.md）、扩展骨架、Cmd+E 占位
