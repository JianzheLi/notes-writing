# Changelog

## [Unreleased]

### Added

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
