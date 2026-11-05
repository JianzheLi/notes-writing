# 设计评审：MATE 现状逐项对照（含 M5/M6/M7 建议）

- 评审快照：2026-11-05，`PLAN.md`、`DEV-PLAN.md`、`agent-complete/README.md`，以及 `src/prompt.ts`、`context.ts`、`extension.ts`、`chatClient.ts`、`latexCheck.ts`、`panel.ts`、`macros.ts`、`outline.ts`、`lastRequest.ts`
- 注意：评审期间 M4（宏定义/小节/缓存指标）正在实现，部分文件仍在变。本文评价的是**设计决策**，不是最终 diff；若后续实现与本文描述不一致，以代码为准。
- 置信度：**高** = 代码/文档/论文直接证据；**中** = 推理合理但缺本项目数据；**低** = 需实验。
- **实现后注记**：V5（截断用同参数重试）已在 M4 后续修复：`finish_reason=length` 会调大 `max_tokens`（最多 16384）重试一次，仍截断则放弃；`content_filter` 等其它非 `stop` 原因直接放弃。E8 的文档状态已同步。

## 1. 总评

**架构方向正确，不需要推翻。** 单轮无状态 + 结构化上下文 + 确定性语法校验 + 一次重试，正好落在"任务简单、延迟敏感、成功标准可机械判定"的最优区间；M4 引入的宏定义抽取、小节路径、长文档开窗、缓存命中展示，也都是 context engineering 的正确动作。

真正的问题从"架构对不对"变成了两件事：

1. **没有评估闭环**：所有上下文/prompt 改动（包括 M4 和未来的 M7）都无法证明收益，只能靠主观感受；这是当前最大风险。
2. **若干具体机制缺口**：截断后的无效重试、非选区路径下"描述句"的位置、默认 32k 预算偏大、FIM 模式缺少独立校验策略。

下面逐项展开。

## 2. 逐项对照

### 2.1 架构与交互层

| # | 决策 | 现状 | 判定 | 依据 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| A1 | 单轮、无状态 Chat Completions | 每次请求独立，不保留会话 | **合理** | 任务是单步生成；Anthropic 建议先优化单次调用；无状态让 pending/abort 逻辑简单 | 高 |
| A2 | 仅手动触发，不做打字自动补全 | `Cmd+E` 显式触发 | **合理** | 生成式任务不适合自动触发；延迟与成本不可控 | 高 |
| A3 | Ghost text + Tab/Esc | pending 命中后 `inlineSuggest.trigger` | **合理** | 符合 VS Code 补全交互；不阻塞编辑器 | 高 |
| A4 | 选区用装饰器红/绿预览而非 ghost text | `showSelectionPreview`，Tab 才替换 | **合理** | ghost text 的 range 不能跨行（代码注释也写明），装饰器是正确折中 | 高 |
| A5 | 手动选区替换 + `Cmd+Z` 可撤销 | 已实现 | **合理** | 用户可预期的编辑语义 | 高 |
| A6 | 单候选输出 | system 规则 5 要求"只给一个" | **合理** | 多候选增加延迟/歧义，与 ghost text 不匹配 | 高 |
| A7 | 无多轮、无工具调用、无 memory/RAG/向量库 | 均未实现 | **合理** | 公式生成没有环境交互与跨请求状态；见 [agent-architectures.md](agent-architectures.md) | 高 |
| A8 | 行内/行间/续写/选区的自动判定 + 两个强制命令 | `mathScan`/`mathMode` + 命令 | **合理**，但复杂度偏高 | 确定性判定能减少模型歧义；代价是 457 行启发式要长期维护 | 中 |
| A9 | 自动模式（`auto`）把判定权交给模型 | `styleHint` 让模型自行决定 | **有隐患**：双权威 | 本地已算出 `math.mode`，prompt 又让模型自己判断；两者冲突时输出不可控 | 中 |
| A10 | 选中文字标红、替换标绿 | 已实现 | **合理** | 破坏性操作有预览与撤销，风险低 | 高 |

### 2.2 上下文层

| # | 决策 | 现状 | 判定 | 依据 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| C1 | 结构化上下文（文件、小节、宏、前文、光标、后文） | M4 后齐全 | **合理** | 对应 context engineering 的"最小高信号 token 集" | 高 |
| C2 | 宏定义抽取（`\newcommand` 等，mask 非数学区） | `macros.ts` + `MACRO_RATIO=0.15` | **合理** | 直接改善"沿用宏"这条规则的可执行性 | 高 |
| C3 | 小节路径（如 `1. 引言 > 1.1 背景`） | `outline.ts` | **合理** | 给模型文档位置感，成本很低 | 高 |
| C4 | 长文档开窗 + "前面内容已省略"标记 | `context.ts` 新逻辑 | **合理** | 避免从左侧硬截断丢掉宏/小节 | 高 |
| C5 | 短文档直接发完整 prefix/suffix，宏块置空去重 | 已实现 | **合理** | 避免重复 token；省一次拼接 | 高 |
| C6 | 默认上下文 32k tokens | `contextTokens=32000`，按 3.5 字符/token ≈ 112k 字符 | **偏过度** | 公式输出只有几十 token；绝大多数笔记整篇 < 112k 字符，等于每次发全文。context 越多注意力越稀释（context rot），且 prefill 更慢更贵 | 中高 |
| C7 | 前文:后文 = 0.9 : 0.1 | `PREFIX_RATIO=0.9` | **合理** | 写作顺序进行，前文信息量更大；后文主要用来判断句型/闭合 | 中 |
| C8 | 字符/token 换算常数 3.5 | `CHARS_PER_TOKEN=3.5` | **有偏差风险** | 中文 token 密度与英文不同，`contextTokens` 名义是 token 实际按字符估算；长中文文档可能明显低于/高于预算。可用 `usage.promptTokens` 校准 | 中 |
| C9 | 非选区路径把"描述句"放在前文末尾 | user message 中前文占 90%，描述句在长前缀尾部、后文之前；短文档路径下后文可能是全文剩余部分 | **缺口** | 关键信息落在长上下文中段（Lost in the Middle：中段召回最差）；表现为"偶尔偏题" | 中 |
| C10 | 选区描述块放在 suffix 之后、要求之前 | M4 后顺序已调整 | **合理** | 近因位置，符合"关键信息靠尾部" | 中 |
| C11 | 稳定排序、忽略标记 | 宏/小节在前、易变内容在后 | **合理** | 缓存友好；DeepSeek 缓存按完整前缀单元匹配 | 高 |
| C12 | 排除 glob（`.env`、`*secret*`、`*.pem`、`*.key`） | 默认配置已加 | **合理** | 隐私面收敛 | 高 |

### 2.3 输出校验与重试层

| # | 决策 | 现状 | 判定 | 依据 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| V1 | 用确定性代码做语法检查 | `$`/`{}`/`\left-\right`/`\begin-\end` | **合理** | 形式化约束用代码检查最可靠、零成本；比 LLM 自评好 | 高 |
| V2 | 只拦"明显坏"的公式，完整校验交给 LaTeX Workshop | 检查项克制 | **合理** | 避免误杀与重复造轮子 | 高 |
| V3 | 失败反馈具体错误 + 重试 1 次 | `buildRetryMessage` 列具体 issue | **合理** | evaluator-optimizer 的轻量版；反馈可执行 | 高 |
| V4 | 重试用 append-only 消息 | 追加 assistant + user | **合理** | 天然复用前缀缓存（DeepSeek 文档例一） | 高 |
| V5 | 截断（`finish_reason=length`）也走"反馈重试" | `withTruncationIssue` 把截断变成 issue，重试参数不变 | **缺口（明确 bug 级）** | 模型看到"可能被截断"也无法改变 `max_tokens`；大概率再截断一次，白花延迟与成本 | 高 |
| V6 | 任意非 `stop` 的 finishReason 都进入重试 | 包括 `content_filter` 等 | **缺口** | 内容过滤类重试无意义，应直接放弃并提示 | 中 |
| V7 | `maxTokens` 固定 8192 | 配置默认值 | **偏保守/可优化** | 非思考模式公式输出远小于此；思考模式 8192 可能又不够。建议按 effort 动态给（none→512/1024，思考→8192+） | 中 |
| V8 | 错误分类 + 状态栏 + 不弹窗 | 已实现 | **合理** | 写作场景不打断用户 | 高 |
| V9 | 没有 429/5xx 的退避重试 | 只做代理候选尝试 | **可接受，小缺口** | 编辑器场景可让用户重按；加退避会拉长等待。若做，限制 1 次且仅 429/5xx | 中 |
| V10 | pending 校验 uri/version/position，过期丢弃 | 已实现 | **合理** | 避免把旧结果插到错误位置 | 高 |
| V11 | inflight abort（重复触发取消上一次） | 已实现 | **合理** | 用户连按不会排队堆积 | 高 |

### 2.4 工程与可观测

| # | 决策 | 现状 | 判定 | 依据 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| E1 | 日志记录耗时/上下文大小/usage，不记完整 prompt | 输出面板 | **合理** | 可诊断且隐私风险低 | 高 |
| E2 | 缓存命中率展示 | M4 后状态栏/控制台显示 `cache %` | **合理** | 让"排序是否有效"可观察，M4 的正确配套 | 高 |
| E3 | 控制台可切模型/effort/style/预算 | `panel.ts` | **合理** | 不用改配置就能试参数，利于自测 | 高 |
| E4 | `thinking` 默认 none、思考模式不发 temperature | `chatClient.ts` | **合理** | 与 DeepSeek 文档一致（思考模式 temperature 不生效） | 高 |
| E5 | API key 支持文件/.env/环境变量/SecretStorage | 已实现 | **合理**，但注意 | 发布版要确保 `api.txt` 不进 vsix、不进 git；README 已有提示 | 高 |
| E6 | 只有纯函数单测，没有生成质量评估 | `tests/*.test.mjs` | **最大缺口** | 语法检查、mathScan 等可用单测覆盖；但"公式是否合理/是否符合符号习惯"无法用单测判断 | 高 |
| E7 | 无 bench 的 p50/p95 报告 | `scripts/bench.mjs` 存在但未成体系 | **缺口** | 无法回答"32k 是否比 8k 慢多少" | 高 |
| E8 | 文档/里程碑状态不一致 | `agent-complete/README.md` 仍写 M2 状态；`PLAN.md` 写仓库 private、`DEV-PLAN.md` 写 public | **缺口（发布前必修）** | 影响 Marketplace 观感与配置；也不利于回归定位 | 高 |

## 3. 过度设计清单（建议收敛）

1. **默认 32k 上下文**：除非有实测证明长上下文提升复杂公式质量，否则默认 8–12k 更合理；32k/128k 保留为"长文档"显式档位。改动最小、收益（延迟/成本/注意力）最直接。置信度：中高。
2. **`maxTokens=8192` 一刀切**：非思考模式 512–1024 足够，思考模式再单独给大值。置信度：中。
3. **`auto` 模式的双重判定**：本地 `mathScan` 已经给出模式，prompt 又让模型自行判断。建议本地确定时直接给硬提示；只有本地不确定时才让模型选。置信度：中。
4. **规则在两处重复**（system 与 `styleHint` 都说"只输出公式"）：不影响正确性，但增加维护成本；可保留 system 的原则性规则，把具体格式说明集中到 `styleHint`。置信度：低。

## 4. 缺口清单（按优先级）

| 优先级 | 缺口 | 具体动作 | 置信度 |
| --- | --- | --- | --- |
| P0 | 没有生成质量评估集 | 建 20–30 条真实 fixture（行内/行间/续写/选区/多行环境/宏/长文档/中文描述），脚本跑 pass 率 + 人工盲评 | 高 |
| P0 | 截断走无效重试 | `length` 分支改为调参或放弃；不要伪装成语法错误 | 高 |
| P1 | 描述句位置在长上下文中段 | 在 user message 末尾加"最近 1–3 行"复述（20–50 token），A/B 验证 | 中 |
| P1 | 默认预算偏大 | 默认 8–12k，长文档再升；用 bench 对比质量/延迟 | 中高 |
| P1 | FIM 模式没有独立策略 | 见 M5 建议 | 高 |
| P2 | 没有 429/5xx 轻量重试 | 可选，最多 1 次、仅 429/5xx | 中 |
| P2 | 无 workspace trust 处理 | 不可信工作区禁用网络发送或降级 | 中 |
| P2 | 文档/里程碑不一致 | 发布前统一 README/PLAN/DEV-PLAN/CHANGELOG | 高 |

## 5. M5 建议（代码/FIM 与发布）

1. **FIM 按官方约束实现**：`base_url` 用 `/beta`，参数 `prompt` + `suffix`；仅非思考模式，不要传 `thinking` 参数；最大补全 4K（文档明确）。置信度：高。
2. **FIM 使用独立的 suffix 预算**：Chat 模式 0.9/0.1 合理，但 FIM 的 suffix 是主要信号（决定"中间要补什么"），建议 suffix 占 30–50%，且优先保留光标所在行与下一行。置信度：中高。
3. **校验按语言分派**：`.py` 不要跑 `checkLatexSuggestion`（会把合法代码的大括号/`$` 误判），只检查空输出/截断/长度；公式模式才跑 LaTeX 检查。置信度：高。
4. **FIM 输出清洗**：去重模型重复的 prompt/suffix 边界、trim 行尾、保留缩进；不要套用公式的定界符校正。置信度：高。
5. **Notebook 先验证再承诺**：`.ipynb` 的 ghost text 与 `inlineSuggest.trigger` 是否可用未验证；不可用就降级为"快捷键直接插入"，并在 README 写清差异。置信度：中（未验证）。
6. **发布前产物审计**：`.vscodeignore` 排除 `api.txt`、`.env*`、`node_modules` 中不必要文件、`tests/`、`scripts/`；解包 vsix 确认无密钥、体积可控。置信度：高。
7. **文档一致性**：README 状态更新到实际里程碑；PLAN 与 DEV-PLAN 的 public/private 描述统一；CHANGELOG 覆盖 M1–M5。置信度：高。
8. **bench 成体系**：同一组 fixture 跑 8k/32k 两档，记录 TTFT、p50/p95、cache hit、token 成本，结论写进 README/CHANGELOG。置信度：高。
9. **workspace trust**（可选）：不可信工作区里禁用自动读取/发送，或至少提示。置信度：中。

## 6. M6 建议（Marketplace）

1. **数据使用声明是第一优先级**：README/Marketplace 页面必须明确"会把当前文件上下文发送到 DeepSeek API、需要自备 API key、会产生费用"，并提供排除配置（已有 `excludeGlobs`）。置信度：高。
2. **首次使用引导**：安装后引导设置 API key（SecretStorage）+ 代理（只走用户已有代理，不自行直连）+ 试一次示例。置信度：高。
3. **发布元数据**：publisher/名称一致、图标、LICENSE、CHANGELOG、`engines.vscode`（当前 ^1.85.0）与 API 使用一致；截图用真实 ghost text/控制台。置信度：中。
4. **体积与启动开销**：检查 `onStartupFinished` 是否必要（可改为命令/view 激活）；去掉未使用依赖；vsix 控制在合理体积。置信度：中。
5. **遥测默认关闭**：若加遥测必须 opt-in 且不含文件内容；没有遥测也要在 README 说明。置信度：中。
6. **文案不过度承诺**："辅助写公式、手动触发、公式需自行检查"，避免"自动写论文"类表述。置信度：高。
7. **发布流程**：vsce 打包 → 本地装 vsix 回归 → 打 tag → 发布；pre-release 与正式版分开。置信度：中。

## 7. M7 建议（可选 agent）

**结论：不建议做完整 agent；建议做 2–3 个"agent-lite"，且默认关闭。**

先设决策门槛，满足至少两条才值得投入：

- 评估集显示复杂公式的失败原因主要是"上下文里缺信息"（跨文件宏、跨小节符号），而不是模型能力；
- 用户能接受 5–15s 的等待（或只在显式命令里接受）；
- 有可靠自动反馈（例如 LaTeX 编译结果）可用于闭环。

**候选 A（首推，且不算 agent）：项目级确定性上下文扩展器。**
把 M4 的同文件宏提取扩展到工作区：解析 `\input`/`\include`、`\newcommand` 所在文件、`\cite` 参考文献条目、常用符号表，作为稳定前缀注入。实现是本地解析 + 一次请求，不引入工具调用循环、不改变延迟量级。置信度：高。

**候选 B（条件性 evaluator）：最多 1 次额外模型调用。**
仅在语法检查失败且错误提示"语义类"（如环境配对没错但结构可疑），或用户显式执行"更严谨地重写"命令时触发；由第二个 prompt 检查符号一致性/量纲/是否回答描述，再把意见交给生成模型改一次。不要默认进入 `Cmd+E` 路径。置信度：中。

**候选 C（编译反馈闭环，tool-use 的轻量版）：**
生成后用 LaTeX Workshop/latexmk 编译一次，失败则把编译错误回填重试 1 次。只在显式命令触发、可配置关闭；要处理编译环境缺失、耗时（可能数秒）与临时文件清理。置信度：中（依赖本机 TeX 环境，未验证）。

**明确不做**：ReAct 自主循环、multi-agent、向量记忆/长期记忆、默认多候选。理由见 [agent-architectures.md](agent-architectures.md)：任务单步、无环境交互、延迟敏感，复杂架构只会增加成本与不可解释性。置信度：高。

**若做 B/C 的硬约束**：最多 2 次模型调用；总超时 ≤10s；任何一步失败 fail-open 回退到单轮结果；所有步骤有日志与开关；不改变 `Cmd+E` 的默认路径。

## 8. 最大设计风险（Top 3）

1. **没有评估闭环（最大风险，高）**：M4 的宏/排序/开窗、未来的 M7，全部只能靠"感觉变好了"来验收；一旦质量回退也无法定位。修复成本很低（20–30 条 fixture + 一个小脚本），收益是后续所有决策的前提。
2. **关键信息位置 + 过大默认上下文（中高）**：非选区路径下，用户刚写的描述句位于长前缀尾部、光标标记和后文之前，正好是 Lost in the Middle 的弱区；32k 默认又放大了稀释效应。表现是偶发偏题、难复现。建议"降默认预算 + 末尾短复述"一起 A/B。
3. **截断路径的无效重试（高，代码级确定）**：`finish_reason=length` 时用同一 `max_tokens` 再请求一次，几乎必然再次截断；在思考模式下每次可能多等数十秒。应改为调参或直接提示。

补充风险：**双权威判定**（本地 `math.mode` vs 模型 auto）与**强制模式的严格 checker**叠加时，启发式一旦判错，合法公式会被拒；建议记录"mode 与最终 style 不一致"的样本并定期回看。

## 9. 建议的最小验证实验（低成本）

- 数据：20–30 条 fixture，覆盖行内/行间/续写/选区/多行环境/自定义宏/长文档/中文描述/易错边界（`\$`、`\{`、金额）。
- 变体：A = 当前 32k；B = 8–12k；C = B + 末尾"最近 1–3 行"复述；D = C + 2–3 个 few-shot。
- 指标：语法一次通过率、重试率、人工盲评（1–5 分：正确/符号一致/格式正确）、p50/p95 延迟、cache hit、token 成本。
- 判定：只有 B/C/D 在盲评上稳定优于 A 才落地；否则保持简单。**在没有这组数据前，不建议再加任何架构复杂度。**

## 参考

- [Anthropic, Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic, Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Liu et al., Lost in the Middle: How Language Models Use Long Contexts (arXiv:2307.03172)](https://arxiv.org/abs/2307.03172)
- [Shinn et al., Reflexion: Language Agents with Verbal Reinforcement Learning (arXiv:2303.11366)](https://arxiv.org/abs/2303.11366)
- [DeepSeek API Docs, 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)
- [DeepSeek API Docs, 思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)
- [DeepSeek API Docs, FIM 补全（Beta）](https://api-docs.deepseek.com/zh-cn/guides/fim_completion)
