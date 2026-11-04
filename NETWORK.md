# 网络与数据流说明（供 IT / 合规确认）

- 插件：`agent-complete`（VSCode 扩展，本地开发版，未发布到 Market）
- 版本：0.1.0（M1）
- 日期：2026-11-04
- 用途：说明这个插件运行时**如何联网、发给谁、发什么、走不走代理**

## 1. 一句话概括

插件只在用户**按 `Cmd+E`**（或手动运行"网络诊断"）时发起请求：把**当前文件的片段上下文**通过**本机配置的代理**发送到 **DeepSeek 官方 API**，拿回 LaTeX 公式；其余时间没有任何网络请求、没有后台轮询、没有遥测。

## 2. 数据流

```
用户在编辑器里按 Cmd+E
  → 扩展在本地读取当前文件上下文（光标前文 / 光标后文 / 当前小节）
  → 解析本机代理（见第 4 节）
  → 通过该代理建立 TLS 连接：api.deepseek.com:443
  → HTTPS POST /chat/completions
  → DeepSeek 返回公式文本
  → 扩展在本机显示 ghost text 预览
  → 用户按 Tab 才会写进当前文件；Esc 取消
```

## 3. 联网目标（只有两个端点）

| 动作 | 方法 | 地址 | 触发时机 |
| --- | --- | --- | --- |
| 生成公式 | POST | `https://api.deepseek.com/chat/completions` | 每次按 `Cmd+E` |
| 网络诊断 | GET | `https://api.deepseek.com/models` | 手动执行"网络诊断"命令 |

- 域名：`api.deepseek.com`（默认值，可在设置 `agentComplete.baseUrl` 改为内部网关）
- 端口：443，HTTPS
- 没有：更新检查、遥测、统计上报、CDN 请求、第三方 SDK 请求

## 4. 发送的数据内容

每次 `Cmd+E` 发送一个 Chat Completion 请求，包含：

1. **API key**：放在 `Authorization: Bearer ...` 请求头
2. **固定系统提示词**：公式写作规则（约 200 字）
3. **用户消息**，包含：
   - 当前文件的**相对路径**、语言的 language id（如 `markdown` / `latex`）
   - 当前小节标题（从当前文件中提取）
   - **光标前文**：默认最多约 10 万字符（上下文预算 32k token 的 90%，可配置，上限 128k token）
   - **光标后文**：默认最多约 1.1 万字符（预算的 10%）
   - 模式提示：行内公式 / 行间公式 / 续写已有公式
4. **模型参数**：`model=deepseek-flash`、`max_tokens=8192`、`stream=false`、`thinking enabled`、`reasoning_effort=max`

**不发送**：

- 工作区里的其他文件（除非用户把光标放在那个文件里再按 `Cmd+E`）
- 文件名列表、目录结构、git 信息、用户名、机器名
- 遥测/使用统计（插件本身没有任何上报）

**注意**：上下文预算可在设置里调小（`agentComplete.contextTokens`），或把敏感文件加入 `agentComplete.excludeGlobs`（默认排除 `.env`、`*.key`、`*.pem` 等），命中后按 `Cmd+E` 会直接拒绝、不发请求。

## 5. 代理与网络路径（重点）

插件**不会绕过本机代理**，按以下顺序解析，依次尝试：

1. `agentComplete.proxy`（用户在插件设置里手动指定）
2. `http.proxy`（VS Code 自身的代理设置）
3. 环境变量：`HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`（含小写）
4. **macOS 系统代理**：读取 `scutil --proxy`（只读命令），支持 SOCKS5 / HTTPS / HTTP 代理

代理协议处理：

- **SOCKS 代理** → 使用 `socks5h`，**域名解析交给代理服务器**（和 `curl --socks5-hostname` 一致），DNS 不直连
- **HTTP/HTTPS 代理** → 使用标准 `CONNECT` 隧道
- 多个候选依次尝试；**所有候选都失败就报错，不会自动切开直连**
- 只有**本机完全没有代理配置**时才直连（和其他程序的行为一致）
- 扩展不修改系统代理设置，只做读取

## 6. 代理服务器能看到什么

- 能看到：目标域名 `api.deepseek.com`、TLS SNI、连接建立时间、流量大小、访问频次
- 看不到：HTTPS 请求/响应正文（除非代理做了 **TLS 中间人**，在本机安装了根证书并解密）
- 如果做了 TLS 检查：目前插件依赖 Node 默认证书链，尚未配置 `NODE_EXTRA_CA_CERTS`；如需信任根证书可以再加

## 7. 本地存储与日志

- **API key**：可放在本地 `api.txt`（默认在工作区根目录/扩展目录/上一级查找，文件已在 `.gitignore` 中），或存在 VS Code `SecretStorage`（macOS 上是 Keychain）；两种情况都不进代码仓库、不打印
- **日志**：VS Code 输出面板 `Agent Complete`，记录：语言、行内/行间模式、思考强度、代理来源、上下文长度、输出长度、耗时、token usage、错误原因；**不记录 prompt 正文和 key**
- 日志仅存在本机，不会上传

## 8. 如何核验

- 命令面板 → `Agent Complete: 网络诊断`：打印代理来源，并用 `GET /models` 实测连通性（不消耗补全 token）
- 终端执行 `scutil --proxy` 查看系统代理
- 输出面板 `Agent Complete` 里每次请求都有 `proxy=system/http.proxy/env/...` 记录

## 9. 已知限制

- 暂**不支持 PAC 自动配置脚本**（`http.proxy` 里配 PAC URL 会失败，会显示错误）
- 暂**不支持代理用户名/密码认证**
- Windows / Linux 的系统代理自动读取未实现（可用 `agentComplete.proxy` 或环境变量手动指定）
- 插件未发布到 Market，只从本地源码运行（F5 开发宿主 / vsix）

## 10. 建议确认的问题

1. 是否允许调用外部 LLM API（`api.deepseek.com`）？是否允许上传论文/代码片段作为上下文？
2. 代理是否需要认证、是否使用 PAC？如需，请提供代理地址/认证方式，插件可以适配。
3. 是否对 HTTPS 做 TLS 检查？如果做，需要提供根证书路径，插件会加入信任链。
4. 是否有更合适的**内部网关**可替代 `api.deepseek.com`？（插件支持改 `baseUrl`，网关需兼容 OpenAI Chat Completions 格式）
5. 代理访问日志的保留与审计要求是什么？

## 11. 版本与变更

- 2026-11-04：M1 版本网络层为 Node 原生 `https.request` + 显式代理 Agent（跟随本机代理，不绕过）；早期基于 `fetch` 的实现已废弃（与 VS Code 扩展宿主代理存在兼容问题）。
- 代码位置：`notes-writing/agent-complete/`，仓库：https://github.com/JianzheLi/notes-writing
