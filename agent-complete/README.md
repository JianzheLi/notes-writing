# Agent Complete

在 Markdown / LaTeX 里写完文字描述，按 **`Cmd+E`**，让 DeepSeek 帮你写出 LaTeX 公式，以 ghost text 显示，`Tab` 接受。

## 当前状态（M2：选区替换与判定完善）

- ✅ `Cmd+E` 触发：取光标前文/后文（默认 32k token 预算）→ DeepSeek Chat Completions（`deepseek-flash`，默认思考强度 `max`）→ 后处理 → ghost text
- ✅ 行内/行间判定：在 `$...$`、`\(...\)` 里继续补全；在 `$$`、`\[...\]`、`equation/align*` 等数学环境里继续补全；其余情况交给模型看上下文决定（`formulaStyle=auto`），不再硬判“行尾=行间”
- ✅ 判定健壮性：数学环境白名单（`figure/table/document` 不误判）、LaTeX `%` 注释、Markdown 代码块/行内代码、`\$` 转义、金额 `$100` 与未闭合 `$` 的启发式
- ✅ 选区替换预览：选中一段描述按 `Cmd+E`，原文标红、替换内容标绿，**`Tab` 才真正替换 / `Esc` 取消**（多行/整行选区默认行间，句中短语默认行内；接受后 `Cmd+Z` 可撤销）
- ✅ 强制命令：`Agent Complete: 生成行内公式` / `Agent Complete: 生成行间公式`
- ✅ 思考强度可配（`none/low/high/max`），默认 `max`
- ✅ 状态栏显示生成中 + 已耗时；失败只提示不弹窗
- ✅ 输出面板 `Agent Complete` 记录耗时、上下文大小、usage
- ⏳ 还没做（后续 milestone）：语法检查+重试（M3）、`.py` FIM 续写、`.ipynb`（M5）

## 本机调试（F5）

1. 用 VS Code 打开 **`agent-complete` 文件夹**（不要打开上层 `notes-writing`，`launch.json` 的 `${workspaceFolder}` 指向扩展目录）。
2. 按 `F5`，会新开一个"扩展开发宿主"窗口。
3. 在新窗口按 `Cmd+Shift+P` → 执行 **`Agent Complete: 设置 DeepSeek API Key`**；或者把 key 放到仓库根目录的 `api.txt`（扩展会自动读取，文件已在 `.gitignore` 里）。
4. 打开一个 `.md` 或 `.tex` 文件，写完一句描述、把光标放在要插入公式的位置，按 **`Cmd+E`**。
5. 公式以 ghost text 出现后：`Tab` 接受、`Esc` 取消、`Cmd+→` 逐词接受。
6. 选区替换：选中一句描述（整行或句中短语都行）再按 `Cmd+E`，原文标红、替换内容标绿；`Tab` 接受替换，`Esc` 取消。

## 配置项

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `agentComplete.model` | `deepseek-flash` | 也可选 `deepseek-v4-pro` |
| `agentComplete.reasoningEffort` | `max` | `none` = 非思考（快）；`low/high/max` = 思考，越高质量越好但越慢 |
| `agentComplete.contextTokens` | `32000` | 上下文预算，上限 128000 |
| `agentComplete.maxTokens` | `8192` | 单次最大输出 |
| `agentComplete.temperature` | `0.2` | 仅非思考模式生效 |
| `agentComplete.timeoutMs` | `90000` | 请求超时 |
| `agentComplete.formulaStyle` | `auto` | `auto` 由模型判断行内/行间；`inline / display` 强制 |
| `agentComplete.languages` | markdown / latex / tex / python | 允许触发的语言 |
| `agentComplete.baseUrl` | `https://api.deepseek.com` | 代理/网关时改这里 |
| `agentComplete.apiKeyFile` | `api.txt` | 本地 key 文件名；相对工作区/扩展目录/上一级查找，命中后自动读取 |
| `agentComplete.proxy` | 空 | 手动指定代理（优先于自动检测），如 `socks5://127.0.0.1:13659` |

### API key 的几种方式（按优先级）

1. **`api.txt`**：在仓库根目录（或 `agent-complete/`）放一个 `api.txt`，内容一行 `sk-...` 即可（也支持 `DEEPSEEK_API_KEY=sk-...`）。扩展每次请求时自动读取，文件已加入 `.gitignore`。
2. **`.env`**：仓库根目录的 `.env` 会被自动读取（只认 `DEEPSEEK_API_KEY=`，不会把别的变量当 key）。可以从 `.env.example` 复制：`cp .env.example .env`。`.env` 已在 `.gitignore` 里。
3. **环境变量**：`DEEPSEEK_API_KEY=sk-...`（适合从终端启动 VS Code / CI）。
4. **SecretStorage**：命令面板 `Agent Complete: 设置 DeepSeek API Key`，存进系统钥匙串。

也可以把 `agentComplete.apiKeyFile` 设成任意文件名/绝对路径；文件不存在时会继续尝试后面的方式。

## 排错

- **按 `Cmd+E` 没反应**：`Cmd+Shift+P` → `Preferences: Open Keyboard Shortcuts` → 搜索 `agentComplete.trigger`，看快捷键是否被别的命令占用；也可以在键盘快捷方式里改。
- **看日志**：输出面板（`Ctrl+Shift+U` / `Cmd+Shift+U`）选 `Agent Complete`，能看到每次生成的耗时、上下文大小、token usage。
- **需要 `editor.inlineSuggest.enabled` 为 true**（默认是 true）。
- **网络/代理**：始终 **跟随本机代理**（优先 `agentComplete.proxy`，其次 `http.proxy`、环境变量、macOS 系统代理），不自行直连，和电脑其它程序上网方式一致；只有本机完全没配代理时才直连。SOCKS 代理统一用 `socks5h`（由代理解析域名，和 curl `--socks5-hostname` 一致）。
- **网络诊断**：命令面板执行 `Agent Complete: 网络诊断`，会在输出面板打印代理来源，并用 `GET /models` 实测连通性（不消耗补全 token）。
- **合规提示**：插件会把当前文件上下文发送到 DeepSeek 云端 API；是否允许使用第三方 API、以及内容范围，请遵循所在环境的规定。

## 目录

```
src/
  extension.ts    # 命令、provider、状态栏、错误处理
  chatClient.ts   # DeepSeek Chat Completions 调用
  context.ts      # 上下文采集与预算裁剪、排除文件
  mathScan.ts     # 数学状态扫描（纯函数：$、环境、注释、代码块）
  mathMode.ts     # 行内/行间/选区样式判定
  prompt.ts       # system/user prompt
  postprocess.ts  # trim、去围栏、定界符处理
  types.ts        # 共享类型
tests/            # 纯函数单测（node:test）
scripts/
  smoke.mjs       # 真实 API 冒烟测试（用文字描述生成公式）
  bench.mjs       # 延迟基准（FIM 接口，M5 用）
```

## 开发命令

```bash
npm install
npm run compile      # tsc
npm run watch        # 监听编译
npm test             # 编译 + node:test 纯函数单测
DEEPSEEK_API_KEY=sk-xxx node scripts/smoke.mjs max   # 冒烟测试
npm run package      # 打 vsix（需要 vsce）
```
