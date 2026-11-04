# 提示词与上下文工程调研：TAME 的 system prompt、上下文拼装与重试

一句话结论：TAME 的 prompt 已经"够用且方向正确"；真正能提升的部分不在措辞，而在**信息放哪里**（顺序/预算）和**失败后怎么处理**（截断与校验分流）。下面按主题拆开。

## 1. System prompt：短、具体、可执行

Anthropic 的 context engineering 文章给 system prompt 的建议是：语言清晰直接、处在"正确的 altitude"——既不要用 if-else 式硬编码把 prompt 写脆，也不要只给笼统的高层目标；推荐用 XML 标签或 Markdown 标题把 prompt 分成若干 section（如背景、指令、工具、输出描述），并保持"最小的、足以完整描述期望行为"的信息量。注意"最小"不等于"短"：必要信息要给足，但不要堆砌边界 case。

对照 TAME 的 `SYSTEM_PROMPT`（`src/prompt.ts`）：

| 现有规则 | 评价 |
| --- | --- |
| 只输出公式本身，不要解释/代码块/多余句子 | 好。约束了最常见的后处理问题 |
| 行内 `$...$` / 行间 `$$...$$`，沿用已有环境 | 好。但"沿用 `equation/align`"与"用 `$$`"之间，模型可能选错；本地 `styleHint` 已兜底 |
| 沿用上下文中的符号、记号习惯、宏定义 | 好，但**前提是上下文里真的有宏定义**。M4 计划抽宏，否则这条规则是空头支票 |
| 光标处已有公式片段时只补全剩余部分 | 好，且与 `continue-inline/display` 模式一致 |
| 只输出一个最合理的公式，不要多选项 | 好。多候选应该由 UI/命令提供，而不是 model 自选 |
| 选区文字只是描述，直接给替换公式 | 好。这是容易出错的地方，写清楚值得 |

**建议（按优先级）：**

1. **加 2–3 个 canonical few-shot 示例**，尤其覆盖"行内续写"和"选区替换"两个最容易偏的模式。Anthropic 明确建议 curated examples 而非规则堆砌（"examples are the pictures worth a thousand words"）。示例放在 system 内固定位置，利于前缀缓存。置信度：中高。
2. **减少"双权威"**：`auto` 模式下，system 规则与 `styleHint()` 都要求模型自行判断行内/行间/续写；如果本地 `mathScan` 已经确定，建议把确定结果作为**硬提示**传给模型（如"光标在已打开的 `$...$` 内，只输出内容，不要 `$`"），而不是让模型重新判断。置信度：中。
3. **规则去重**：`styleHint()` 已经说了"只输出公式"，system 里也有；保留一处即可，减少 prompt 长度与潜在冲突。置信度：低（影响很小）。
4. **不要在 system 里写具体文件路径/时间**：这些属于易变信息，放 user 且靠后，避免破坏缓存前缀。置信度：高（机制见第 5 节）。

## 2. 结构化上下文：顺序比长度更重要

### 2.1 Lost in the middle

Liu et al. 的 *Lost in the Middle* 在多文档 QA 和 key-value 检索上发现：**相关信息出现在输入开头或结尾时表现最好，出现在长上下文中段时显著下降**，即使是对长上下文优化的模型也一样。Anthropic 的 context engineering 文章也强调 context 是有限"attention budget"，token 越多召回越容易退化（context rot）。

这对 TAME 的两个直接推论：

1. **关键信息应该靠近首尾**。TAME 的 user message 当前顺序是：文件元信息 → 小节 → （选区）→ 光标前文（长，约占 90% 预算）→ `【光标位置】` → 光标后文 → 要求。用户刚写的那句"描述"位于**长前缀的末尾**，而它到 message 结尾之间还隔着一整段 suffix——所以描述句实际落在中段偏后。这是最值得改的一点。
2. **"多给前文"要有上限**。`PREFIX_RATIO = 0.9` 本身合理（公式主要依赖前文），但 32k 预算下前文长到 28k 字符时，模型对最近几行的注意力会被稀释。默认预算 8–16k 可能是更好的起点（见第 4 节）。

### 2.2 建议的 user message 布局

```
[1] 文件元信息（路径、语言）           ← 半稳定，靠前
[2] 文档级稳定上下文（宏定义/符号表/当前小节） ← 最稳定，靠前
[3] 光标前文（按预算截断，保留靠后部分）
[4] 【光标位置】
[5] 光标后文（短预算）
[6] 焦点复述：光标前最近 1–3 行（很短）
[7] 任务要求 + 风格提示（styleHint）
```

- [1][2] 放最前，是为了让每次请求的**前缀尽量相同**（缓存友好），同时把"背景信息"放在首因位置。
- [6] 是**近因强化**：用 20–50 个 token 把用户刚写的描述再复述一遍，抵消 [3] 过长带来的注意力稀释。代价极小，且不影响 [1][2] 的缓存前缀（[6] 本来就是易变区）。置信度：中；建议用 A/B 验证，不要直接当结论。
- [7] 放最后是"指令近因"：模型对最后一条指令的遵从通常更好（这是经验性判断，**未验证**于 DeepSeek 具体模型，需要实验）。

### 2.3 预算分配

| 内容 | 现状 | 建议 |
| --- | --- | --- |
| 总预算 | 默认 32k，上限 128k | 默认 8k–16k；32k 作为长文档档位 |
| 前文 : 后文 | 0.9 : 0.1 | Chat 模式保持；FIM 模式单独配置（后缀是主要信号） |
| 选区 | 最多占总预算 50% | 合理；选区通常很短，实际很少触发 |
| 宏/符号表 | 未实现（M4） | 给固定小预算（如 1–2k），优先于远处的正文 |
| 截断对齐 | 对齐到行边界 + UTF-16 代理对 | 合理，无需改 |

## 3. 输出约束：纯文本 + 后处理，不要 JSON

- **继续用纯文本输出公式**。公式本身是 `$...$` / `$$...$$` / 环境块，接近模型在预训练里见到的自然形式；如果要求 JSON，需要额外的引号和反斜杠转义，模型更容易写错，解析也更容易失败。Anthropic 在 tools 附录里的建议是"让格式尽量接近模型在自然文本中见过的样子，避免转义开销"——同样适用于这里。
- **单候选**是正确选择：多候选会让输出变长、歧义增加，且与 ghost text 一次只预览一个的交互不匹配。
- **确定性后处理继续保留**：trim、剥 ```latex 围栏、补/去定界符。这是对模型不服从的兜底，成本为零。
- **强制模式命令**（行内/行间）是很好的显式约束：当自动判定可能错时，用户可以用命令给出确定信号。建议把这条写进 UI 提示/README，而不是只藏在命令面板。

## 4. 自检与重试：确定性校验器优先

### 4.1 为什么用代码而不是 LLM 自检

- 形式化约束（`$` 配对、`{}` 平衡、`\left/\right`、`\begin/\end`）用代码检查**100% 可复现、零延迟、零成本**；LLM 自评既慢，又可能和生成时犯同一类错。
- Reflexion 的经验是：来自外部环境的反馈信号（测试、编译结果）比模型自己的"反思"更可靠。TAME 的语法检查器就是这个"外部信号"的最小版本。
- 用 evaluator-optimizer 的框架看：TAME 已经是"生成器 + 确定性评估器 + 最多一次改进"，符合官方说的适用条件（评估标准清晰、迭代有可测收益）。置信度：高。

### 4.2 现有重试逻辑的两个缺口

1. **截断（`finish_reason=length`）不应走反馈重试**。代码里 `withTruncationIssue()` 把截断也转成一条 issue，然后 `buildRetryMessage()` 让模型"修正"，但**请求参数没变**（同样的 `max_tokens`、同样的 effort）——模型大概率再被截断一次，白花一次钱和延迟。正确做法是：识别 `length` 后**调整参数**（提高 `max_tokens`，或降低思考强度以给输出留空间），或者直接放弃并提示"输出被截断"，不要伪装成语法错误。置信度：高（代码直接证据）。
2. **重试没有区分错误类型**。语法错误可以反馈重试；`content_filter` 类结束原因重试无意义；网络/超时错误应走另一个分支。建议按 `LatexIssueCode` + `finishReason` 建一张小矩阵决定"重试 / 调参 / 放弃"。置信度：高。

### 4.3 重试策略建议

- **最多 1 次**：保持现状。Reflexion 的收益来自多次 trial，但那是离线/可重试任务；编辑器内重试两次以上会显著拉高 p95 延迟，且失败原因通常不是"再多想一轮"。
- **反馈信息要具体、可执行**：现有 `buildRetryMessage()` 会列出具体错误（如"`\left` 与 `\right` 数量不等（left 2 / right 1）"），这是好实践；可以再加一句"只改有问题的部分，其余保持"，减少全量重写。
- **append-only 重试**：现有实现是在原 messages 后追加 assistant + user，这既符合多轮语义，也**天然命中前缀缓存**（DeepSeek 的缓存示例一：`A+B` → `A+B+C` 可命中 `A+B` 的前缀）。不要改成"重写整个 prompt"。
- **重试也要能取消/超时**：现有 `inflight` abort 机制已覆盖，保持。
- **要测的指标**：首次通过率、重试后通过率、重试带来的额外延迟、重试请求的缓存命中率。没有这些数字，"重试 1 次"是否划算只能靠感觉。

## 5. Context engineering：把 token 当预算花

Anthropic 的指导原则可以概括为："找到**最小的、高信号的 token 集合**，最大化期望结果"。落到 TAME：

1. **排除文件/目录必须生效**（已有 `isExcluded()`）。发布版里建议默认排除 `.env`、`.git/**`、密钥类文件，并在 README 明确"会把当前文件上下文发给 DeepSeek"。
2. **不要为了"完整"塞整篇文档**。公式的依赖通常是：最近的文字描述、当前小节、少见的宏定义。整篇 32k 里真正相关的可能不到 2k。
3. **不做 RAG/向量检索**（当前）。单文档、单次请求、符号局部性强，确定性解析（宏、`\input`、同文件符号）足够；向量检索引入索引、延迟与隐私成本，收益无法论证。置信度：中。
4. **"just-in-time" 检索暂不需要**。Anthropic 描述的是多轮 agent 在运行时用工具按需取数；TAME 是单轮，预取更简单、更可控。

## 6. 前缀缓存与请求顺序

### 6.1 DeepSeek 缓存的机制（据官方文档）

- 上下文硬盘缓存**默认开启**，无需改代码。
- 命中前提是**完整匹配"缓存前缀单元"**：每个请求在"用户输入结束位置"和"模型输出结束位置"各产生一个缓存前缀单元；系统还会检测多次请求的公共前缀并单独落盘；长输入/输出会按固定 token 间隔切分落盘。
- 例一：请求 `A+B` 之后再请求 `A+B+C`，第二轮可命中 `A+B`。例二：`A+B` 与 `A+C` 不命中，但公共前缀 `A` 会被落盘，第三轮 `A+D` 可命中 `A`。
- `usage` 里有 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 可观测（TAME 的 `chatClient.ts` 已读取 `cached_tokens` / `prompt_cache_hit_tokens`，这是对的）。
- 缓存是"尽力而为"，不保证 100% 命中；构建耗时秒级；不再使用后几小时到几天自动清空。
- 缓存只匹配输入前缀，输出仍受 `temperature` 等参数影响，效果与不缓存一致。

### 6.2 对 TAME 的 5 条具体规则

1. **顺序固定**：system → 文件元信息 → 宏/符号表 → 当前小节 → 前文 → 后文 → 近因复述 → 指令。任何"随机/时间戳/请求 id"都不要出现在前面。
2. **同一次会话内不要随手改 system prompt**（例如根据模式拼接不同 system 文本）。模式差异放在 user 的 `styleHint()` 里，system 保持字节级一致，缓存前缀才稳定。置信度：高。
3. **重试用 append-only**（现状正确），不要重排消息。
4. **用 `usage` 做缓存观测**：在控制台/日志里显示 `hit / (hit+miss)`，按"模型 × 模式"分别统计。没有观测就无法判断排序改动是否有效。
5. **注意最小可缓存长度**：DeepSeek 文档没有给最小前缀长度；其它厂商通常有门槛（如 1024 token 级别），TAME 的 system prompt 本身可能太短而不构成独立缓存单元——**未验证**。实践上靠"长前缀（正文）"来命中最划算。

### 6.3 缓存 vs 注意力的冲突

两者要求的"重要内容位置"看似相反：缓存要稳定在前，注意力要关键在首尾。实际可以同时满足：**首部放稳定的背景（system、宏、文件元信息），尾部放最关键的指令与最近的描述**，中间放长正文。唯一无法缓存的是每次都在变的尾部——这本来就是缓存机制预期的。

## 7. 落地检查清单

- [ ] system prompt 固定、不含易变信息；模式差异放 user
- [ ] user message 顺序：元信息 → 宏/符号 → 前文 → 光标标记 → 后文 → 近因复述 → 指令
- [ ] 默认上下文预算下调到 8–16k，长文档才开 32k+（A/B 验证）
- [ ] 输出保持纯文本；后处理兜底；不引入 JSON
- [ ] 语法检查继续用代码；检查项与 `mode` 匹配
- [ ] 截断走调参分支，不走向语法反馈重试
- [ ] 重试最多 1 次，append-only，可取消
- [ ] 记录并展示 `prompt_cache_hit_tokens` / 延迟 / token 成本
- [ ] 排除 glob 生效；README 有隐私说明

## 参考

- [Anthropic, Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic, Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Liu et al., Lost in the Middle: How Language Models Use Long Contexts (arXiv:2307.03172)](https://arxiv.org/abs/2307.03172)
- [Shinn et al., Reflexion: Language Agents with Verbal Reinforcement Learning (arXiv:2303.11366)](https://arxiv.org/abs/2303.11366)
- [DeepSeek API Docs, 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)
- [DeepSeek API Docs, 思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)
- [DeepSeek API Docs, FIM 补全（Beta）](https://api-docs.deepseek.com/zh-cn/guides/fim_completion)
- [DeepSeek API Docs, JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode)
