# Agent 架构调研：哪些模式值得用，哪些是过度设计

一句话结论：**公式生成是单步任务，不需要 ReAct / planning / multi-agent；需要的是更好的上下文选择和确定性的输出校验。** 下面是推理过程与来源。

## 1. 先统一术语：workflow 与 agent 不是一回事

Anthropic 在 *Building effective agents* 里把两类系统做了明确区分：

- **Workflow**：LLM 与工具按**预先写死的代码路径**编排（prompt chaining、routing、parallelization、orchestrator-workers、evaluator-optimizer）。
- **Agent**：由 **LLM 自己动态决定**流程和工具使用，通常是在环境反馈上循环多轮。

同一篇文章的核心建议是：先找最简单的方案，只有在能证明收益时才增加复杂度；"很多应用把单次 LLM 调用配合检索和上下文示例优化好就够了"。判断是否值得上 agent，主要看任务是否**开放式、步数不可预测、需要环境反馈**。TAME 的公式生成恰好三条都不满足：

| 维度 | 公式生成的实际形态 | 是否触发 agent 条件 |
| --- | --- | --- |
| 步数 | 一次生成 + 至多一次修正 | 否（可预测） |
| 外部环境反馈 | 无（不读文件系统、不跑编译、不搜网） | 否 |
| 成功标准 | 可机械判定（`$`/`{}`/`\left`/`\begin`、截断） | 否（不需要模型判断是否完成） |
| 输出长度 | 几十个 token | 否 |
| 延迟预算 | 编辑器内 1–3s（用户按完快捷键在等） | 强烈反对多轮 |
| 失败代价 | 低（Esc 取消，无副作用） | 不需要为可靠性堆循环 |

**判断：单轮调用是这类任务的正解，不是妥协。**（高置信度）

## 2. 各模式逐项评估

### 2.1 单轮 LLM 调用（augmented LLM）

Anthropic 把"LLM + 检索/工具/记忆等增强"称为 agentic system 的基础 building block。注意：**增强不等于 agent**——把结构化上下文塞进一次调用仍属于单轮模式。TAME 当前就是"单轮 Chat Completions + 结构化文件上下文 + 后处理 + 确定性校验"，属于这个 building block 的合理实例。

**适用 TAME：是，主模式。**（高）

### 2.2 Prompt chaining（提示链）

把任务拆成固定几步，每步一次 LLM 调用，可在中间加程序化 gate。官方给的适用条件：任务能干净地拆成固定子任务，用延迟换准确率。典型例子是"先列提纲→检查→再写正文"。

对 TAME：**当前不需要**。公式生成没有可拆的固定子任务；硬拆（先选模式→再生成→再检查）会把 1 次调用变 3 次，延迟翻倍，而中间产物（模式）本来就能由本地启发式给出。唯一接近的变体是"生成 → 校验 → 失败重试"，但那已经是 evaluator-optimizer，且校验是代码而不是 LLM。（高）

### 2.3 Routing（路由）

先分类再交给专门的下游 prompt。TAME 其实已经有一个**极轻量的确定性路由**：`mathScan`/`mathMode` 判定行内、行间、续写、选区，然后 `styleHint()` 生成不同的用户指令。这是代码路由，不是 LLM 路由，成本为零，方向正确。

潜在缺口：`auto` 模式下判定权在"模型自己看上下文决定"，同时本地又算了 `math.mode`。**两套权威并存**时，如果本地判定错，prompt 会把模型往错误方向推。建议明确规则：本地能判定时以本地为准（确定性优先），本地不确定才交给模型，并让语法检查在模式冲突时放宽而不是直接判死。（中）

### 2.4 Parallelization（并行 / 投票）

两个变体：sectioning（独立子任务并行）和 voting（同一任务跑多次取聚合）。对公式生成，voting 的收益是"多候选里挑一个"，但代价是 N 倍延迟与成本；编辑器内交互场景基本不可接受。Anthropic 也指出并行适合"需要多视角提高置信度"的离线评估类任务。

对 TAME：**默认不做**；如果未来做"多候选"，也应改成**用户显式触发的第二条命令**，而不是把 `Cmd+E` 变慢。（高）

### 2.5 Orchestrator-workers / multi-agent

Anthropic 的多 agent 研究系统数据很有说服力：orchestrator + 并行 subagent 在内部研究评测上比单 agent 高 90.2%，但 multi-agent 的 token 消耗约为普通 chat 的 15 倍；文章同时明确说"多数编码任务的真正可并行子任务比研究少，且 LLM agent 目前并不擅长实时协调和委派"。

对 TAME：**明确不适用**。理由：任务太短（一次调用能完成）、没有并行子任务、延迟预算 1–3s、错误可回退。mult-agent 在这里只会引入协调开销和不可解释性。（高）

### 2.6 Evaluator-optimizer（生成 → 评估 → 改进）

"一个 LLM 生成，另一个提供反馈，循环改进"。官方适用条件：**有清晰的评估标准，且迭代改进能带来可测量收益**。TAME 的"语法检查失败 → 把具体错误追加给模型 → 重试 1 次"在结构上就是这个模式，区别是：评估器是确定性代码而不是 LLM。

这是**比 LLM-as-judge 更适合本任务的选择**：LaTeX 定界符/括号/环境配对是形式化约束，代码检查 100% 可复现、零额外成本、零额外延迟（本地毫秒级）；LLM 自评既慢又可能和生成模型犯同样的错。Reflexion 论文也说明反馈信号可以是自由文本或标量，外部反馈（如编译/测试）通常比模型自省更可靠——这对 TAME 的含义是：**校验器要尽量"外部化、形式化"**。（高）

### 2.7 ReAct（reasoning + acting 交错）

ReAct 的做法是让模型交错输出推理轨迹和动作（如调用 Wikipedia API），用环境返回的信息更新后续动作。论文报告在 HotpotQA/Fever 上减少幻觉，在 ALFWorld/WebShop 上显著超过模仿学习和 RL 基线。

关键点：**收益来自"与外部环境交互"**。TAME 的模型没有动作空间（不搜索、不读其他文件、不执行），ReAct 退化成"让模型在输出里写一段思考再给公式"，收益可疑，而且思考 token 会直接增加延迟。DeepSeek 的思考模式（`reasoning_effort`）本质是模型内置的推理，与 ReAct 的显式工具循环不同；`none` 默认值对简单公式是合理的。

对 TAME：**不需要**。若复杂推导质量不够，优先级应是先加高质量示例/提高 effort 档位，而不是引入工具循环。（高）

### 2.8 Reflexion（语言化反思 + 情节记忆）

Reflexion 不更新权重，而是让 agent 对任务反馈做语言化反思，存进 episodic memory，供下一次尝试使用；论文报告 HumanEval pass@1 91%（对比 GPT-4 80%）。注意它的设定是**同一任务可多次重试，且每次有明确反馈信号**（如单元测试）。

映射到 TAME：现有"失败→反馈→重试 1 次"只保留了"当次任务内的反思"，没有跨请求记忆。**这是合理的取舍**：公式生成是低频、独立、无状态请求，跨请求记忆会引入陈旧上下文与隐私问题；而 Reflexion 的收益依赖多次 trial，与 1–3s 延迟预算冲突。唯一值得借鉴的是"反馈要具体、可执行"——TAME 的 `buildRetryMessage()` 已经列出具体错误，这比笼统说"再试一次"好。（高）

### 2.9 Planning（显式规划）

显式 plan（先写步骤再执行）适合多步、路径不唯一的任务。单条公式的"计划"就是选行内/行间 + 选记号，属于一步决策，不需要单独规划阶段。DeepSeek 的 thinking 模式已经提供"隐式草稿"，且默认关闭；把 plan 显式化只会增加输出 token 和解析复杂度。

对 TAME：**不需要**。（高）

### 2.10 Tool use（函数调用）

只有当模型必须获取**它不知道且上下文里没有**的信息时才需要工具。TAME 的所有信息（文档、宏、小节、光标位置）都可以在发请求前由扩展代码采集好——这比让模型发起工具调用更快、更可控。Anthropic 对工具设计的建议（清晰的 ACI、poka-yoke、格式贴近自然文本）在这里的等价物是：**把上下文拼装当作"零成本工具"来设计**。

如果未来要加"读另一个文件/宏定义"，优先做**确定性预取**（解析 `\newcommand`、`\input`、同文件符号表）注入上下文，而不是给模型 `read_file` 工具让它自己决定读什么。（高）

### 2.11 Memory（长期记忆 / RAG / 向量库）

Anthropic 的 context engineering 文章把"长期任务"的记忆手段分为 compaction、structured note-taking、sub-agent 三种，并强调 context 是有限资源、"context rot"会让长上下文里的召回变差。这些手段的适用前提是**跨多轮、上下文超窗**——TAME 单次请求最多 32k，且每次请求独立，没有需要跨请求保持的状态。

对 TAME：**不需要向量库/长期记忆**。个人笔记规模下，检索同文件或同项目的少量符号完全可以用确定性解析完成；向量检索会引入嵌入模型、索引维护、延迟与隐私面。什么时候再考虑：当 TAME 变成"整篇论文多轮改写"（开放式任务）时。（中）

## 3. 正面回答：公式生成需不需要 agent 架构？

**不需要。** 理由按重要性排序：

1. **任务本身是单步的**：输入（上下文 + 描述）→ 输出（公式），不存在需要探索的中间状态。
2. **成功标准可以形式化**：语法检查已经能拦住绝大多数失败模式，不需要 LLM 判断"是否完成"。
3. **延迟是产品体验的一部分**：用户按完快捷键在编辑器里等，任何多轮都会破坏 ghost text 的交互假设。
4. **没有环境可供交互**：ReAct/tool-use/multi-agent 的收益都依赖外部反馈；TAME 的外部反馈（LaTeX 编译）是秒级且更适合作为**产物校验**而非生成循环。
5. **复杂度有维护成本**：多一层循环就多一层状态、超时、取消、缓存失效和可观测性问题；单轮 + 无状态让 pending/abort/pending 校验这些逻辑非常简单。

**什么情况下应该重新考虑？** 满足以下至少两条再做：

- 本地评估集显示复杂公式（多行对齐、自定义宏、跨小节符号）失败率显著高于简单公式，且失败原因是"信息不在上下文里"而不是"模型能力不够"；
- 产品允许把等待时间从 1–3s 放宽到 5–15s；
- 有可靠的自动反馈信号（例如 LaTeX 编译成功/失败），足以支撑 evaluator 循环；
- 用户愿意为每次生成多付一个数量级的 token 成本。

## 4. 结论表

| 模式 | 对 TAME 的适用性 | 建议 | 置信度 |
| --- | --- | --- | --- |
| 单轮调用 + 结构化上下文 | 主模式 | 保持并优化 | 高 |
| 确定性路由（本地判定行内/行间） | 已有 | 明确"本地优先"，减少双权威 | 中 |
| prompt chaining | 不适用 | 不做 | 高 |
| parallelization / voting | 仅离线评估可用 | 不做默认路径 | 高 |
| evaluator-optimizer | 已有轻量版 | 保持；校验器保持确定性 | 高 |
| ReAct | 不适用 | 不做 | 高 |
| Reflexion | 部分借鉴（反馈要具体） | 不做跨请求记忆 | 高 |
| planning | 不适用 | 不做 | 高 |
| tool use | 不适用（改为确定性预取） | 不做模型工具调用 | 高 |
| memory / RAG / 向量库 | 不适用 | 不做 | 中 |
| multi-agent | 不适用 | 不做 | 高 |

## 参考

- [Anthropic, Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic, Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic, How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Yao et al., ReAct: Synergizing Reasoning and Acting in Language Models (arXiv:2210.03629)](https://arxiv.org/abs/2210.03629)
- [Shinn et al., Reflexion: Language Agents with Verbal Reinforcement Learning (arXiv:2303.11366)](https://arxiv.org/abs/2303.11366)
- [Liu et al., Lost in the Middle: How Language Models Use Long Contexts (arXiv:2307.03172)](https://arxiv.org/abs/2307.03172)
- [DeepSeek API Docs, 思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)
