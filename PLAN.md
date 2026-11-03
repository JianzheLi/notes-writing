# agent-complete 插件计划（VSCode · 快捷键触发 · DeepSeek FIM）

- 状态：草案 v0.2（计划迭代中，未开工）
- 日期：2026-11-03（v0.2 更新：2026-11-04）
- 已确认：上下文默认 8k token（4k / 8k / 16k 三档可配，实测后定档）；手动触发、等待几秒可接受
- 本计划目录：`notes-writing/`
- 代码目录（暂定，待确认）：`notes-writing/agent-complete/`

## 1. 一句话结论

可行。用 VS Code 官方的 inline completion API + DeepSeek 官方 FIM 接口，做一个**快捷键触发**的补全插件。手动触发把延迟预算放宽到 2–4 秒，所以上下文可以放到 8k token 左右，同时不需要实时方案的防抖/取消复杂度。

## 2. 目标与非目标

**MVP 目标（M0–M3）**

- 编辑器内按快捷键 → 光标处出现 ghost text → Tab 接受、Esc 取消、Cmd+→ 逐词接受（VS Code 内置）。
- 请求 = 当前文件前缀 + 后缀（逐步加 import / 相关文件），模型 `deepseek-flash`。
- 按一次键到 ghost text 出现：目标 p50 < 1.5s，p95 < 3s（手动触发，几秒可接受）。
- 失败静默降级：状态栏提示，不弹错误弹窗；超时自动放弃。
- API key 存 VS Code `SecretStorage`，不进代码、不进仓库。

**本期不做**

- 打字时自动出现（实时模式）：留开关，以后再加。
- 跨文件编辑、多步 Agent 工具调用：放到 M4 可选阶段。
- Marketplace 发布：先本地 `vsix` 自用。
- 多候选、内联菜单等锦上添花。

## 3. 已验证的接口事实

1. **DeepSeek 有官方 FIM 补全接口**（[FIM Completion API (Beta)](https://api-docs.deepseek.com/api/create-completion)）
   - `base_url = https://api.deepseek.com/beta`，`POST /completions`
   - `model` 可选 **`deepseek-flash`** / `deepseek-v4-pro`
   - 参数：`prompt`（光标前代码）、`suffix`（光标后代码，可选）、`max_tokens`、`stop`、`temperature`、`stream`、`echo`、`logprobs`
   - 返回：`choices[0].text`，`usage` 里带 `prompt_cache_hit_tokens`（前缀缓存命中）
   - 注意：这是 completion 接口，没有 system prompt，靠"原始代码前后文"补中间，正适合补全。

2. **VS Code 官方支持"快捷键手动触发"**
   - 内置命令 `editor.action.inlineSuggest.trigger`，label "Trigger Inline Suggestion"，precondition 只要求编辑器可写（[源码](https://github.com/microsoft/vscode/blob/main/src/vs/editor/contrib/inlineCompletions/browser/controller/commands.ts)）
   - 支持参数 `{ explicit?, showNoResultNotification?, providerId? }`
   - provider 收到的 `triggerKind` 是 `Invoke = 0`，可和打字自动触发（`Automatic = 1`）区分（[vscode.d.ts](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts)）
   - 参考：[InlineCompletionItemProvider API](https://code.visualstudio.com/api/references/vscode-api#InlineCompletionItemProvider)

3. **逐词/逐行接受是内置的**
   - `editor.action.inlineSuggest.acceptNextWord`，ghost text 可见时默认 Cmd/Ctrl+→
   - `editor.action.inlineSuggest.acceptNextLine`

4. 当前实现所在的运行环境是 macOS；默认快捷键先用 `cmd+alt+enter`（可配置）。

## 4. 交互流程（两段式）

```
用户按快捷键
  → 状态栏 "补全中…"（不阻塞编辑器）
  → 采集上下文（本地，<10ms）
  → 调 DeepSeek FIM（1–3s）
  → 拿到文本，写入 pending（记录 uri / 文档 version / 光标位置）
  → executeCommand('editor.action.inlineSuggest.trigger')
  → provider 命中 pending，立即返回 InlineCompletionItem（0ms）
  → VS Code 渲染 ghost text
  → Tab 接受 / Cmd+→ 逐词 / Esc 取消
```

为什么"先算再触发"：把网络请求放在 provider 外面，避免 VS Code 等待时没有反馈；同时这个入口天然留给 M4 的 Agent（2–4s 的多步调用可以塞在"算"这一段）。

## 5. 上下文策略（重点）

### 5.1 "token" 是什么概念

token 是模型的分词单位，粗略换算：

| 内容 | 大约 token |
| --- | --- |
| 1 行普通代码（30–40 字符） | 10–12 |
| 一屏代码（约 50 行） | 500–600 |
| 一个 200 行的源文件 | 约 2–2.5k |
| 一个 400 行的源文件 | 约 4–5k |
| 1000 个汉字 | 约 600–800（估算，以平台分词器为准） |

所以 **2–4k token ≈ 一个 150–400 行的源文件，或者 3–7 屏代码**；8k ≈ 1–2 个中等文件（600–800 行）。

### 5.2 长上下文会不会变慢？会，但不是主要因素

- **主要耗时是输出，不是输入**：输出 token 是串行生成的。按 flash 档 100–200 token/s 估，128 token ≈ 0.6–1.3s。这是总延迟的大头。
- **输入（prefill）是并行的**：4k → 8k 的 prefill 差异估计只有几十到一百多 ms（**待实测**），而且 DeepSeek 有自动前缀缓存：同一位置重复触发、或用户在光标处持续打字时，前缀基本不变，缓存命中会明显更便宜更快。
- **真正导致"慢"的是结构不稳定的上下文**：如果每次请求都把文件顺序、相关文件集合打乱，前缀缓存全失效，那才是主要变慢原因。
- **长上下文还有质量代价**：FIM 高质量区间大概在 2–8k；再长边际收益小，还可能被无关代码带偏。**相关比长更重要。**

结论（已确认）：手动触发 2–4s 预算下，**默认 8k**；配置项保留 4k / 8k / 16k 三档，M2 实测后定档。

### 5.3 建议的上下文预算与排序

按"稳定内容在前、靠近光标的内容在后"排列，最大化前缀缓存命中：

| 层级 | 内容 | 建议预算 |
| --- | --- | --- |
| L0 | 当前文件光标前缀（从行 0 开始，超预算时从最近 N 行截取） | 6k |
| L1 | 当前文件光标后缀（补右括号、后续语句） | 0.5k |
| L2 | 文件头 / import / 类型声明 | 1k |
| L3 | 相关文件（同目录、同名、当前打开） | 以后再加 |

请求形态：`prompt = 稳定块 + 当前文件前缀`，`suffix = 光标后内容`。M2 先只做 L0+L1，M3 再加 L2/L3；每加一层都实测延迟和接受率。

### 5.4 后处理

去首尾空行、去掉模型偶尔输出的 markdown 围栏、按光标缩进对齐、CRLF 兼容、长度硬截断（超 3–4 行丢弃或截断）、空结果给"没有合适的补全"状态栏提示。

## 6. 延迟预算与实测方法

| 阶段 | 估计 |
| --- | --- |
| 上下文组装 | <10ms |
| 网络 RTT + 排队 | 200–800ms（波动大） |
| prefill 4k/8k（未命中缓存） | 几十–200ms（待实测） |
| 输出 128 token | 0.6–1.3s |
| **合计** | **1–3s，手动触发可接受** |

实测方法：在扩展里用 `outputChannel` 打点（请求开始/首字节/完成），跑 20–50 次，报 p50/p95；分别用 4k / 8k / 16k 前缀各测 10 次，决定默认档位。若 p95 超 3s：先把 `max_tokens` 降到 96 / 64，再降上下文档位，最后考虑换 `stop` 序列。

## 7. 里程碑

| 阶段 | 内容 | 估时 | 验收 |
| --- | --- | --- | --- |
| M0 骨架 | 扩展脚手架、快捷键命令、provider 返回固定文本 | 0.5h | 按键出现 ghost text，Tab 插入，Esc 取消 |
| M1 接通模型 | FIM 客户端、key 存 SecretStorage、prefix+suffix、状态栏、超时 | 0.5–1d | 真实补全出现；断网/超时只提示不弹窗 |
| M2 上下文 | 8k 预算、排序策略、L2 文件头、后处理、配置项 | 1d | 样本场景补全质量可接受，延迟日志可看 |
| M3 打磨 | 前缀缓存优化、光标移动丢弃、多语言选择、README、vsix | 0.5–1d | 装 vsix 日常能用，p95 < 3s |
| M4（可选） | Agent 增强：仓库检索、诊断校验、慢路径 `deepseek-v4-pro` | 1–2d | 2–4s 内给出更"懂项目"的补全 |

## 8. 工程结构

```
agent-complete/
├── package.json          # 命令、快捷键、配置项、engines
├── tsconfig.json
├── src/
│   ├── extension.ts      # activate：注册 provider + 命令
│   ├── fimClient.ts      # DeepSeek /beta/completions 调用
│   ├── context.ts        # 上下文采集、预算裁剪、排序
│   ├── state.ts          # pending 结果 + 光标/version 校验
│   └── log.ts            # outputChannel 延迟日志
└── .vscode/launch.json   # F5 调试
```

请求形态（M1）：

```bash
curl https://api.deepseek.com/beta/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-flash",
    "prompt": "<光标前代码>",
    "suffix": "<光标后代码>",
    "max_tokens": 128,
    "temperature": 0.2,
    "stream": false
  }'
```

## 9. 风险与坑

1. **Copilot 抢占**：同时注册了 inline provider 时，VS Code 可能优先显示 Copilot 的候选；开发期先禁用 Copilot 的 inline suggest，或按语言限定。
2. `editor.inlineSuggest.enabled` 必须为 true，否则触发命令无效。
3. **FIM 是 Beta 接口**：参数/模型可能变，代码里把 endpoint 和 model 做成配置项。
4. **光标移动/文档修改**：pending 必须校验 `uri + version + position`，过期直接丢弃，不要显示到错误位置。
5. **多行缩进**：ghost text 的多行缩进要自己保证；接受前最好在真实 TS/Python 文件里验证。
6. **隐私**：代码会发到 DeepSeek 云端；加"排除文件"设置（`.env`、密钥文件），并让用户明确知情。
7. **密钥安全**：只存 `SecretStorage`，不设环境变量兜底写进 settings。
8. **网络波动**：`api.deepseek.com` 的排队/超时要在 UI 上可感知（状态栏），避免按键后毫无反应。
9. 语言范围：先支持 TS/JS/Python；Markdown/纯文本默认不触发。

## 10. 需要你确认的事项

1. DeepSeek API key 是否已有？插件里首次使用时输入并保存，可以吗？
2. 你主要写什么语言/项目？（决定默认语言范围和测试样本）
3. 默认快捷键用 `cmd+alt+enter` 可以吗？还是你想沿用某个习惯键？
4. 是否装了 GitHub Copilot？开发期介意先禁用它做对比吗？
5. 插件代码就放在 `notes-writing/agent-complete/`，还是你想放到 `papers/` 之外？
6. ~~默认上下文档位先给 8k，还是直接上 16k 试速度？~~ 已确认：默认 8k，保留 16k 档做实验。

## 11. 下一步

你确认上面几个点后，我先做 **M0 + M1**：出第一个能装的 `vsix`，你按快捷键就能看到真实 ghost text。拿到你的实测体感（延迟、补全质量）再决定 M2 上下文怎么加、M4 要不要 Agent。

## 12. 决策记录

| 日期 | 决策 | 说明 |
| --- | --- | --- |
| 2026-11-04 | 上下文默认 8k token | 用户确认"长一些"；4k / 8k / 16k 三档可配，M2 实测后定档 |
| 2026-11-04 | 手动触发，等待时间几秒可接受 | 用户确认"停几秒就行"；不做实时防抖/取消，延迟预算 2–4s |

