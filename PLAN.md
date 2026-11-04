# agent-complete 插件计划（VSCode · Cmd+E · DeepSeek）

- 状态：v0.8（M0–M3 已完成、待验收；下一步 M4 上下文工程）
- 日期：2026-11-03（v0.5 更新：2026-11-04）
- 仓库：`notes-writing/`（分支 main，git 身份 `jianzheli <jianzheli@stu.pku.edu.cn>`，远程 https://github.com/JianzheLi/notes-writing）
- 代码：`notes-writing/agent-complete/`；开发流程见 [DEV-PLAN.md](DEV-PLAN.md)
- 里程碑编号与验收以 [DEV-PLAN.md](DEV-PLAN.md) 为准（本文第 10 节为早期编号，后续以 DEV-PLAN 的顺序执行）。
- 已确认：快捷键 `Cmd+E`；上下文默认 32k、配置上限 128k；默认思考强度 **none**（控制台可切 high/max）；语言 `markdown / latex / tex / python`；
  仅手动触发；主场景 = 写完文字描述后让 AI 写公式（行内 / 行间）；必须做简单语法检查；
  行内/行间 auto + 两个强制命令。

## 0. 版本变化

**v0.2 → v0.3**

1. 场景换了：从"Copilot 式代码补全"改为"写完文字描述 → 按 Cmd+E → AI 写出 LaTeX 公式"，这是**生成任务**，主接口从 FIM 换成 **Chat Completions（非思考模式）**。
2. `.py` 的代码续写保留为第二模式（M2，用 FIM 接口）。
3. 行内 / 行间公式自动判定 + 设置项 + 强制命令。
4. 增加输出后处理与**简单语法检查**（`$`、`{}`、`\left/\right`、`\begin/\end`），失败自动重试一次。
5. 快捷键定为 `Cmd+E`；git 身份已配置并 amend。

**v0.3 → v0.4**

6. 上下文默认从 8k 提高到 **32k**，配置上限 **128k**。
7. 补充"FIM 是什么、框架一般怎么用"的说明。
8. 补充模型与思考强度选项（`deepseek-flash` / `deepseek-v4-pro`；`none/low/high/max`）。

**v0.4 → v0.5**

9. 默认思考强度定为 **`max`**（`deepseek-flash` + thinking enabled + `reasoning_effort: max`）；`maxTokens` 提到 8192、`timeoutMs` 提到 90s。
10. 远程仓库已创建并推送：GitHub `JianzheLi/notes-writing`（private）。
11. 新增 [DEV-PLAN.md](DEV-PLAN.md)：开发流程、子智能体分工、审查清单、里程碑与提交/打 tag 规则。
9. 远程仓库：本机没有 GitHub 凭证，需要用户登录后由我创建（见第 15 节）。

## 1. 一句话结论

可行。做一个**生成式公式助手**：在 Markdown / LaTeX 里写完文字描述，按 `Cmd+E`，插件把上下文发给 `deepseek-flash`，拿到 LaTeX 公式，做简单语法检查后以 ghost text 显示，`Tab` 接受。手动触发，等待 2–5 秒可接受。

## 2. 使用场景

**主场景（M1）**：写完描述（例："样本方差的无偏估计为"），光标放在要插入公式的位置，按 `Cmd+E`：

| 光标位置 | 期望行为 |
| --- | --- |
| 在 `$...$` 行内公式里 | 只补全公式剩余部分，不输出 `$` |
| 在 `$$...$$`、`\[...\]`、`equation`、`align` 环境里 | 只补全环境内内容，不重复环境标记 |
| 不在数学环境、光标在行尾/空行 | 生成行间公式块（前后空行 + `$$...$$`） |
| 不在数学环境、光标在句子中间 | 生成行内公式 `$...$` |
| 有选区 | 选区文字视为"描述"，生成公式并**替换选区** |

**次场景（M2）**：`.py` / `.ipynb` 的 code cell 里按 `Cmd+E` → 代码续写（FIM）。

**不做**：打字时自动触发；自动改写整段文档。

## 3. 已验证的 API 与 VS Code 事实

### DeepSeek（[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)）

- 模型：`deepseek-flash`（DeepSeek-V4.1-Flash-1017）、`deepseek-v4-pro`（V4-Pro-0813）。
- **上下文 1M tokens**（输入 + 输出合计），**最大输出 384K**。
- 思考模式默认开启（effort `high`）；可用 `"thinking": {"type": "disabled"}` 关闭（或 `reasoning_effort: "none"`）。
- 非思考模式 `max_tokens` 默认 8K；思考模式默认 64K。
- 价格（flash）：输入 cache miss 非高峰 $0.15/1M、高峰 $0.3/1M；cache hit 非高峰 $0.003/1M；输出非高峰 $0.6/1M、高峰 $1.2/1M。高峰 = 周一至周五 UTC 01:00–04:00、06:00–10:00。
- FIM Completion（Beta）：仅非思考模式，`POST https://api.deepseek.com/beta/completions`，参数 `prompt` + `suffix`。

### 模型与思考强度选项

| 选项 | 参数 | 效果 |
| --- | --- | --- |
| 非思考（可切） | `thinking: {"type": "disabled"}` | 最快、最便宜；简单/中等公式足够 |
| 思考 low | `thinking: enabled` + `reasoning_effort: "low"` | 稍慢，复杂公式更稳 |
| 思考 high（API 默认） | `reasoning_effort: "high"` | 更慢，难题更准 |
| **思考 max（高质量选项，非默认）** | `reasoning_effort: "max"` | 最慢（10–60s），质量优先；难公式可选 |
| 换模型 | `deepseek-v4-pro` | 更强更贵，适合很难的推导 |

注意：思考模式下 `temperature` 不生效；`deepseek-flash` 非思考模式 `top_p` 固定 1.0。

### FIM 是什么、框架一般怎么用

- **FIM（Fill-In-The-Middle）**：把"光标前文本"作为 `prompt`、"光标后文本"作为 `suffix` 一起给模型，让它生成中间部分。Copilot 式代码补全就是这种模式。
- **框架和模型交互的常见分工**：代码/文本**续写**用 FIM（快、便宜、符合补全语义）；**指令式生成**（"按这段描述写公式"）用 Chat Completions（能下规则、能控制格式、能重试修正）。
- **本项目**：公式生成（主场景）用 Chat Completions；`.py` 代码续写（M2）用 FIM；两者共用同一套 UI（`Cmd+E` → ghost text → `Tab`）。

### 接口

```jsonc
// 公式生成（主）
POST https://api.deepseek.com/chat/completions
{
  "model": "deepseek-flash",
  "thinking": { "type": "disabled" },
  "messages": [
    { "role": "system", "content": "…公式助手规则…" },
    { "role": "user",   "content": "…文档上下文 + 描述…" }
  ],
  "max_tokens": 512,
  "temperature": 0.2,
  "stream": false
}

// 代码续写（M2）
POST https://api.deepseek.com/beta/completions
{ "model": "deepseek-flash", "prompt": "<光标前代码>", "suffix": "<光标后代码>",
  "max_tokens": 128, "temperature": 0.2 }
```

### VS Code

- `editor.action.inlineSuggest.trigger`（手动触发，`explicit: true`）
- `InlineCompletionTriggerKind.Invoke = 0`（与自动触发的 `Automatic = 1` 区分）
- `editor.action.inlineSuggest.acceptNextWord` / `acceptNextLine`（逐词/逐行接受，内置）
- 本机无 Copilot；已装 LaTeX Workshop（language id `latex`）与 Python/Pylance。

## 4. 上下文多长、上限多少

- **API 理论上限**：模型窗口 1M tokens（输入+输出合计），单次输出上限 384K。
- **插件默认 32k，配置上限 128k**（已确认）。32k ≈ 2–4 万汉字（约论文 1–2 节）或 2000–3000 行代码；128k ≈ 8–16 万汉字。
- **实际建议**：公式生成常用 8k–32k 就够；128k 只在需要整章/多文件上下文时开。
- **成本/延迟**：32k cache miss 输入（flash 非高峰）≈ $0.0048/次，128k ≈ $0.019/次；prefill 时间随长度增长，首次请求明显变慢，重复请求靠前缀缓存便宜很多。
- **前缀缓存**：相同前缀重复触发价格只有 1/50（cache hit $0.003/1M），上下文按"稳定内容在前、变化内容在后"排列。

## 5. 架构（两段式）

```
Cmd+E
  → 采集上下文 + 判定行内/行间
  → 调 DeepSeek Chat Completions（非思考；M2 的 .py 用 FIM）
  → 后处理（trim、去围栏、行内/行间格式校正）
  → 简单语法检查（失败 → 反馈重试 1 次 → 仍失败则放弃）
  → pending（记录 uri / version / 光标位置）
  → executeCommand('editor.action.inlineSuggest.trigger')
  → provider 命中 pending，立刻返回 InlineCompletionItem（0ms）
  → ghost text → Tab 接受 / Esc 取消
```

模型等待期间状态栏显示"公式生成中…"，编辑器不阻塞。以后要接 agent（多步、读文件、校验）也放在"先算"这一段。

## 6. Prompt 设计

**system**

```
你是数学公式写作助手。根据用户给出的文档上下文和文字描述，写出应插入光标处的 LaTeX 公式。

规则：
1. 只输出公式本身：不要解释、不要 markdown 代码块、不要多余句子。
2. 行内公式用 $...$；行间公式用 $$...$$（或沿用上下文中已有的公式环境，如 equation/align）。
3. 沿用上下文中的符号、记号习惯和宏定义（\newcommand）。
4. 如果光标处已有公式片段，只补全剩余部分，不要重复已有内容。
5. 只输出一个最合理的公式，不要给多个选项。
```

**user**

```
文件：{path}（{language}）
当前小节：{section}

光标前文：
{prefix}

【光标位置】

光标后文：
{suffix}

要求：根据上面的描述写出公式（{行内 | 行间 | 补全已有公式}）。
```

## 7. 后处理与简单语法检查

**后处理**

- `trim`：去掉字符串首尾的空白/换行（不逐行删行尾空格，避免破坏 Markdown 硬换行）。
- 剥掉模型偶尔加的 ```` ```latex ... ``` ```` 围栏。
- 按行内/行间模式做格式校正（补/去 `$`、`$$` 与空行）。

**简单语法检查**（M1 就做）

| 检查项 | 规则 |
| --- | --- |
| `$` 配对 | 忽略 `\$` 转义后，数量为偶数；行内模式不允许裸 `$` |
| `{}` 配对 | 忽略 `\{` / `\}`，按栈平衡 |
| `\left` / `\right` | 数量相等（成对出现） |
| `\begin{env}` / `\end{env}` | 成对且环境名一致 |

失败处理：把具体错误（如"`$` 数量为奇数"）作为追加消息让模型重试 **1 次**；仍失败则状态栏提示"语法检查未通过，已放弃"，不显示 ghost text。不做完整 LaTeX 校验（交给 LaTeX Workshop 编译）。

## 8. 行内 / 行间判定

顺序：

1. 光标在 `$...$` 内 → 行内（只输出环境内内容）
2. 光标在 `$$...$$`、`\[...\]`、`equation/align` 等环境内 → 行间（只输出环境内内容）
3. 有选区 → 用选区作为描述，生成后**替换选区**（行内/行间按设置或自动判断）
4. 无数学环境：光标在行尾或空行 → 行间块；光标在句子中间 → 行内
5. 设置项 `agentComplete.formulaStyle = auto | inline | display`（默认 auto）
6. 提供两个命令面板命令用于强制：`Agent Complete: 生成行内公式`、`Agent Complete: 生成行间公式`（不额外占快捷键）

## 9. 延迟与成本

- 默认思考 `none`：通常 1–3s；需要更高质量时在控制台/设置切到 `high/max`（复杂公式 20–60s）。prefill 32k 约 0.5–1.5s，缓存命中更快。
- `maxTokens` 默认 8192（思考模式需要给推理留空间），`timeoutMs` 默认 90s。
- 单次成本（flash 非高峰，32k 输入 + 约 2–5k 思考/输出 token）粗算 **$0.01 上下/次**；每天 100 次 ≈ $1。
- 若觉得慢：设置里把 `reasoningEffort` 改成 `none` 即可切回 1–3s 的快速模式，不用改代码。

## 10. 里程碑

| 阶段 | 内容 | 估时 | 验收 |
| --- | --- | --- | --- |
| M0 骨架 | 扩展脚手架、快捷键、provider、pending 机制 | 已完成 80% | 按键能出固定文本 ghost text |
| M1 公式模式 | 上下文采集、行内/行间判定、chat 调用（非思考）、prompt、后处理、语法检查+重试、状态栏、日志 | 1–2 天 | 在 `.md`/`.tex` 写完描述按 Cmd+E，Tab 接受行内/行间公式；语法检查生效 |
| M2 代码/笔记 | `.py` 的 FIM 续写；`.ipynb` 单元格支持（需验证 notebook 里 ghost text 与触发命令是否可用，不行则降级直接插入） | 1 天 | `.py` 里 Cmd+E 能续写代码；`.tex`/`.md` 不受影响 |
| M3 打磨 | 设置项、行内/行间强制命令、缓存、错误提示、README、vsix 打包 | 0.5–1 天 | 可日常使用；延迟 p95 < 5s |
| M4（可选） | agent 增强：读更多上下文（宏定义/符号表/相关小节）、thinking 模式开关、多候选 | 1–2 天 | 复杂公式质量提升 |

## 11. 工程结构

```
agent-complete/
├── package.json          # 命令、快捷键 Cmd+E、配置项
├── tsconfig.json
├── src/
│   ├── extension.ts      # activate：provider + 命令 + pending
│   ├── chatClient.ts     # Chat Completions（公式生成）
│   ├── fimClient.ts      # FIM（M2 代码模式）
│   ├── context.ts        # 上下文采集、预算裁剪、稳定排序
│   ├── mathMode.ts       # 行内/行间判定
│   ├── prompt.ts         # system/user prompt 模板
│   ├── latexCheck.ts     # 简单语法检查
│   ├── postprocess.ts    # trim、去围栏、格式校正
│   └── log.ts
├── scripts/bench.mjs     # 延迟/成本基准（可选）
└── .vscode/launch.json
```

配置项（`package.json` → `contributes.configuration`）：

- `agentComplete.model`：默认 `deepseek-flash`
- `agentComplete.reasoningEffort`：`none | low | high | max`，默认 `none`（非思考）
- `agentComplete.maxTokens`：默认 `8192`
- `agentComplete.temperature`：默认 `0.2`（思考模式下不生效）
- `agentComplete.contextTokens`：默认 `32000`，范围 1000–128000
- `agentComplete.formulaStyle`：`auto | inline | display`，默认 `auto`
- `agentComplete.languages`：默认 `["markdown", "latex", "tex", "python"]`
- `agentComplete.timeoutMs`：默认 `90000`

## 12. 风险与坑

1. **思考模式默认开**：不显式关会慢很多且贵；非思考时必须传 `thinking: {type: "disabled"}`。
2. **行内/行间判错**：提供强制命令兜底。
3. **公式语法检查误判**：`\$`、`\{`、`\\` 等转义要正确忽略，否则会把合法公式判死。
4. **notebook 支持未知**：`.ipynb` 单元格能否用 ghost text 与 `editor.action.inlineSuggest.trigger` 要先验证，不行降级为直接插入。
5. **FIM 仅非思考模式**：`.py` 模式不要传 thinking 参数。
6. **中文/LaTeX 转义**：prompt 里别让模型把中文放进 `\text{}` 或漏反斜杠；后处理检查 `\` 合法性（轻量）。
7. **前缀缓存**：上下文顺序要稳定（宏定义/文件头在前，光标前内容在后），否则缓存失效变慢。
8. **无 Copilot 冲突**：本机没装 Copilot；LaTeX Workshop 暂未占用 Cmd+E，开工前用 Keyboard Shortcuts 再确认一次。
9. **隐私**：代码/笔记会发到 DeepSeek 云端；保留排除 glob（`.env` 等）。
10. **32k/128k 上下文**：默认 32k 会让首次请求 prefill 变慢（0.5–1.5s），缓存后快；128k 只在必要时开。

## 13. 待确认

1. 远程仓库已建好并推送 M0：https://github.com/JianzheLi/notes-writing（private）。
2. 默认思考强度已按你的要求改为 `none`；需要更高质量时在控制台/设置里切到 `high` 或 `max`。
3. 开发流程与分工见 [DEV-PLAN.md](DEV-PLAN.md)，请确认里程碑划分与"先本地验收、再 push 远程"的规则。
4. 计划确认后是否开工 M1？

## 14. 决策记录

| 日期 | 决策 |
| --- | --- |
| 2026-11-04 | 快捷键 `Cmd+E` |
| 2026-11-04 | 上下文默认 32k，配置上限 128k |
| 2026-11-04 | 主场景：写完文字描述 → 生成公式（行内/行间） |
| 2026-11-04 | 行内/行间 auto + 两个强制命令 |
| 2026-11-04 | 做简单语法检查（`$`/`{}`/`\left`/`\begin`），失败重试 1 次 |
| 2026-11-04 | 语言：markdown、latex、tex、python |
| 2026-11-04 | 不做自动触发（仅手动快捷键） |
| 2026-11-04 | FIM 用于 `.py` 代码续写（M2），公式生成用 Chat Completions |
| 2026-11-04 | 默认思考强度 `max`（flash + thinking enabled + reasoning_effort max）；maxTokens 8192、timeout 90s |
| 2026-11-05 | 默认思考强度改为 `none`；新增 Activity Bar 控制台与状态栏入口 |
| 2026-11-05 | M3：简单语法检查（`$`/`{}`/`\left`/`\begin`）+ 失败重试 1 次 + 错误分类 |
| 2026-11-04 | git 身份 `jianzheli <jianzheli@stu.pku.edu.cn>` |
| 2026-11-04 | 远程仓库 GitHub `JianzheLi/notes-writing`（private），M0 已推送 |

## 15. 远程仓库

- 已创建并推送：**https://github.com/JianzheLi/notes-writing**（private，main 分支）
- 本机 GitHub CLI 已登录（账号 `JianzheLi`，token 存在 macOS keyring）
- 每个 milestone 完成后：本地验收通过 → commit 到 main → `git push` → 打 tag（`m0`、`m1`…）
- 开发流程与子智能体分工见 [DEV-PLAN.md](DEV-PLAN.md)
