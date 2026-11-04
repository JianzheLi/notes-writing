# 调研笔记：TAME 的 agent 架构、上下文工程与提示词工程

- 状态：v1（2026-11-05），基于仓库当前代码与 9 份公开资料
- 范围：回答"公式生成这种任务需不需要 agent 架构"以及"TAME 现在的单轮设计对不对"
- 不涉及：实现代码、产品排期、任何非公开信息
- **实现后注记**：评审快照之后，M4 已实现；截断重试已改为“调大 `max_tokens` 或放弃”，其它非 `stop` 原因不再重试；README/PLAN 里程碑状态已同步。

## 1. 调研问题

1. 公式生成（写完一句描述 → 按 `Cmd+E` → 生成 LaTeX）属于哪类任务？ReAct / Reflexion / planning / tool-use / memory / multi-agent 这些 agent 架构对它有没有收益？
2. 单轮无状态 Chat Completions + 结构化上下文 + 确定性语法校验 + 失败重试 1 次，这套基线在文献和一线工程经验里是否站得住？
3. TAME 当前的 prompt 结构、上下文拼装、输出约束、重试策略还有哪些具体缺口？
4. 对 M5（代码/FIM 与发布）、M6（Marketplace）、M7（可选 agent）分别该做什么、不该做什么？

## 2. 方法

- **读现状**：`PLAN.md`、`DEV-PLAN.md`、`agent-complete/README.md`；源码 `src/prompt.ts`、`src/context.ts`、`src/latexCheck.ts`、`src/extension.ts`（生成/重试/选区预览/错误分类主流程）、`src/chatClient.ts`、`src/panel.ts`。
- **查资料**：先 `web_search` 定位来源，再 `web_fetch` 读原文；优先论文原文（arXiv 摘要页）与官方文档，工程博客只作为经验性证据，不作为定论。
- **对比方式**：把 TAME 的每个设计决策映射到文献中的模式，再判断"合理 / 过度 / 缺口"，并给置信度。
- 局限：没有跑真实 API A/B，也没有本项目的人工评分集；凡涉及"质量会提升/下降"的结论都只能算推断，文中已标注。

## 3. 结论摘要

1. **架构判断是对的**：公式生成是"单步、输入明确、输出很短、成功标准可机械判定、延迟敏感"的任务，符合"先做最简单的单次 LLM 调用"这一工程共识；ReAct、planning、多 agent 的收益主要来自多步环境交互，TAME 没有这种环境。**不需要 agent 架构**。（高置信度）
2. **"语法检查 + 反馈重试 1 次"方向正确**：它是 evaluator-optimizer 模式的轻量、确定性版本，比让 LLM 自评更便宜可靠；采用 append-only 重试还能复用前缀缓存。但**输出被截断时用同样参数重试是无效动作**，应改参数而不是加反馈。（高）
3. **上下文不是越多越好**：32k 默认对单条公式偏大，且用户刚写的"描述句"会落在长前缀的中段，正好踩中 lost-in-the-middle 的弱区。建议默认降到 8–16k，并在 user message 末尾用很短篇幅复述"最近几行 + 输出要求"。（中高；对质量的影响需要 A/B 验证）
4. **"前缀缓存友好排序"与"关键信息放首尾"不冲突**：缓存要求稳定内容在前、可变内容在后；注意力要求关键信息靠首尾。两者的共同解是——system prompt 与文件元信息固定在最前，长前缀居中，光标后文与指令放在最后。（高）
5. **当前最大的问题不是模型能力，而是没有评估闭环**：M4 的上下文改动无法证明收益，M7 是否值得做也无从判断。建议把 20–30 条真实 fixture + pass 率/延迟/缓存命中/成本做成脚本，先于任何架构升级。（高）
6. **M7 只建议做 "agent-lite"**：确定性跨文件上下文扩展（宏/`\input`/符号表）+ 条件性一次 evaluator 调用即可；不建议开放自主多步 loop 或多 agent。（高）

## 4. 文件导航

| 文件 | 内容 |
| --- | --- |
| [agent-architectures.md](agent-architectures.md) | workflow vs agent 的边界；ReAct、Reflexion、planning、tool-use、memory、multi-agent 逐项适用性；"公式生成需不需要 agent"的正面回答 |
| [prompt-engineering.md](prompt-engineering.md) | system prompt、结构化上下文、输出约束、自检/重试、context engineering、前缀缓存与请求顺序 |
| [design-review.md](design-review.md) | 逐项对照 TAME 现状（合理/过度/缺口），M5/M6/M7 具体建议与置信度，最大设计风险 |

## 5. 置信度约定

- **高**：有官方文档、论文原文或本仓库代码的直接证据。
- **中**：推理链完整、与公开经验一致，但缺少本项目实测数据。
- **低**：依赖猜测或未验证的平台行为，需要实验确认。
- 标"**未验证**"的内容表示本次没有找到可靠来源，或平台文档未明确说明。

## 6. 边界与提醒

- 外部资料（尤其工程博客）是经验证据，不是定论；文中已尽量区分"论文报告的结果"与"我们的推断"。
- 本调研未覆盖具体价格数字与厂商 SLA，涉及成本处只做定性比较。
- 所有结论都可以被本地评估集推翻——这也是第 5 条结论把"评估闭环"排在架构升级前面的原因。

## 参考

- [Anthropic, Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic, Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic, How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Yao et al., ReAct: Synergizing Reasoning and Acting in Language Models (arXiv:2210.03629)](https://arxiv.org/abs/2210.03629)
- [Shinn et al., Reflexion: Language Agents with Verbal Reinforcement Learning (arXiv:2303.11366)](https://arxiv.org/abs/2303.11366)
- [Liu et al., Lost in the Middle: How Language Models Use Long Contexts (arXiv:2307.03172)](https://arxiv.org/abs/2307.03172)
- [DeepSeek API Docs, 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)
- [DeepSeek API Docs, 思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)
- [DeepSeek API Docs, FIM 补全（Beta）](https://api-docs.deepseek.com/zh-cn/guides/fim_completion)
