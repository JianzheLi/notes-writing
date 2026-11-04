# 开发流程、分工与里程碑（DEV-PLAN）

- 状态：v0.4（M0–M3 已完成，M4 进行中）
- 日期：2026-11-04
- 关联：[PLAN.md](PLAN.md)（产品计划）、远程仓库 https://github.com/JianzheLi/notes-writing（public）
- 代码目录：`agent-complete/`

## 1. 总原则

1. **main 始终保持可编译、可运行**。每个 milestone 结束时 main 是绿的。
2. **每个 milestone 一次提交到远程**：merge/commit 到 main → `git push` → 打 tag（`m0`、`m1`…），并更新 CHANGELOG。
3. **每个 milestone 完成后停下来等用户验收**，确认后再进入下一个。
4. **先定接口与验收，再写代码**：接口契约由 Lead 写进 `src/types.ts`，实现和测试都按它写。
5. **写作用域不重叠**：不同子智能体改不同文件；`package.json`、`src/extension.ts`、`src/prompt.ts` 这些共享文件只由 Lead 改，避免冲突。
6. 不做超出 milestone 范围的改动；发现的问题记到下一 milestone，不顺手扩需求。

## 2. 分支、提交与远程

- 因为 Agent Teams 共享同一个工作目录，**不使用并行分支**（切分支会互相踩）。统一在 `main` 上直接工作，milestone 完成时一次提交。
- 提交信息格式：
  - `M1: 公式生成最小闭环`
  - `M2: 行内/行间判定与选区`
  - `fix: …` / `docs: …` / `chore: …`
- 每个 milestone 完成动作（Lead 执行）：
  1. `npm run compile` 通过
  2. review 通过 + 测试通过 + 用户验收通过
  3. `git add -A && git commit -m "M? : …"`
  4. `git push origin main`
  5. `git tag m? && git push origin m?`
  6. 更新 CHANGELOG 与 PLAN 状态
- 回滚：`git revert <commit>` 或回到上一个 tag；因为 main 始终可编译，风险低。

## 3. 里程碑划分

| 里程碑 | 内容 | 产物 / 涉及文件 | 验收标准 | 估时 |
| --- | --- | --- | --- | --- |
| **M0**（已完成） | 仓库、计划、扩展骨架、Cmd+E 占位、tsc 编译 | `package.json`、`src/extension.ts`、PLAN、DEV-PLAN | `tsc` 通过；远程仓库 main 有提交 | 已完成 |
| **M1 公式生成最小闭环** | Cmd+E → 取光标前 32k 文本 → Chat Completions（flash，thinking max）→ trim/去围栏 → ghost text → Tab | `types.ts`、`prompt.ts`、`chatClient.ts`、`context.ts`（基础版）、`postprocess.ts`、`extension.ts` 接线 | 在 `.tex`/`.md` 写完描述按 Cmd+E 能出公式并 Tab 插入；断网/超时只状态栏提示不弹窗 | 1–2 天 |
| **M2 行内/行间与选区**（已完成） | 数学环境识别、行内/行间判定、`formulaStyle` auto/inline/display、两个强制命令、选区替换 | `mathScan.ts`、`mathMode.ts`、`extension.ts`（命令接线）、`package.json`（命令） | 行内/行间都正确；选区可替换；强制命令生效 | 0.5–1 天 |
| **M3 语法检查与健壮性**（待验收） | `$`/`{}`/`\left/\right`/`\begin-\end` 检查、失败重试 1 次、错误分类（超时/网络/API/空结果）、输出面板日志 | `latexCheck.ts`、`extension.ts`、`log.ts` | 坏公式不显示；错误信息可诊断；日志里无密钥 | 0.5–1 天 |
| **M4 上下文工程** | 结构优先排序（宏定义/符号表/当前小节/前文）、32k/128k 预算裁剪、前缀缓存友好、排除文件生效 | `context.ts`、`prompt.ts` | 长文档下上下文选择合理；缓存命中率可观察；排除文件不上传 | 1 天 |
| **M5 代码模式与发布** | `.py` 的 FIM 续写、`.ipynb` 支持验证（不行则降级）、README、`vsix` 打包、bench 脚本 | `fimClient.ts`、`extension.ts`、`scripts/bench.mjs`、README | `.py` Cmd+E 能续写；vsix 可安装；README 完整 | 1–2 天 |
| **M6（可选）** | agent 增强：跨文件上下文、thinking 档位快捷切换、多候选 | 视需求 | 用户满意 | 1–2 天 |

每个 milestone 内部可以拆成 2–4 个 commit（例如实现、测试、文档），但**只有 milestone 完成时 push + 打 tag**，避免把半成品推到远程主分支。

## 4. 子智能体分工（Agent Teams）

共享同一个工作目录和文件系统；靠**写作用域**和**任务依赖**避免冲突。

| 角色 | 名称 | 职责 | 可写文件（写作用域） |
| --- | --- | --- | --- |
| Lead（我） | lead | 定接口契约、`types.ts`/`prompt.ts`/`extension.ts`/`package.json` 接线、集成、编译、commit/push/tag、向用户汇报 | `agent-complete/src/types.ts`、`prompt.ts`、`extension.ts`、`package.json`、`tsconfig.json`、`.vscode/**`、根目录文档 |
| 实现 A | `impl-core` | Chat/FIM 客户端、后处理、日志 | `src/chatClient.ts`、`src/fimClient.ts`、`src/postprocess.ts`、`src/log.ts` |
| 实现 B | `impl-ctx` | 上下文采集、行内/行间判定、语法检查 | `src/context.ts`、`src/mathMode.ts`、`src/latexCheck.ts` |
| 审查 C | `reviewer` | 只读审查 diff 与接口契约，写 review 报告；不写业务代码 | `docs/reviews/**` |
| 测试 D | `tester` | 测试样例（`.md`/`.tex` fixtures）、纯函数单测、跑编译与测试 | `agent-complete/tests/**` |

**并行策略**

- M1：A 写 `chatClient/postprocess`，B 写 `context`（基础版）→ 可并行；Lead 先提交 `types.ts` 契约，两人按契约实现。
- D 可以并行写 fixtures 与单测（不依赖实现完成，先写失败测试）。
- C 在 A/B 完成后审查；Lead 修完问题后再跑编译。
- `extension.ts` 的接线必须等 A/B 完成后由 Lead 一次完成，避免三方同时改。

**子智能体协作规则**

1. 每个任务先在共享任务板建 task，写明目标、验收标准、写作用域、依赖。
2. 子智能体只改自己 scope 内的文件；需要改共享文件时先用消息通知 Lead。
3. 子智能体完成后报告：改了哪些文件、怎么验证的、遗留问题。
4. 审查者不修改源码；审查意见由实现者或 Lead 修改。
5. Lead 是唯一执行 `git commit/push/tag` 的人。

## 5. 每个 milestone 的标准流程

1. **定契约**（Lead，10 分钟）：在 `src/types.ts` 写接口/类型，在任务板写验收标准。
2. **建任务**（Lead）：拆任务、写作用域、设依赖。
3. **并行实现**（A/B/D）：各自 scope 内实现；D 先写测试。
4. **接线与编译**（Lead）：`extension.ts` 接线，`npm run compile` 必须通过。
5. **审查**（C）：按第 6 节清单审查，输出问题列表。
6. **修复 + 测试**（A/B/D）：修问题；跑 `node --test tests/`（纯函数）+ `npm run compile`。
7. **用户验收**（你）：VS Code 里按 `F5` 启动扩展开发宿主（或装 vsix），按 Cmd+E 实测。
8. **提交远程**（Lead）：通过后 commit → push → tag → 更新 CHANGELOG。
9. **进入下一个 milestone。**

如果第 5–7 步不通过，回到第 4 步修复，不提交远程。

## 6. 审查清单（review checklist）

**接口与正确性**

- [ ] Chat 请求参数正确：默认 `none` → `{thinking: {type: "disabled"}}` 且不传 effort；`low/high/max` 时 `{type: "enabled"}` + 对应 effort
- [ ] `max_tokens`、`temperature`（thinking 模式下不生效要跳过）、`timeoutMs` 按配置传
- [ ] 行内/行间判定边界：光标在 `$...$`、`$$...$$`、`equation/align` 内、行尾、句子中间、选区
- [ ] 语法检查转义处理：`\$`、`\{`、`\}`、`\\` 不能误判
- [ ] 空结果、`finish_reason != stop`、HTTP 错误、超时都有明确处理
- [ ] pending 校验 uri + version + 光标位置，过期结果丢弃

**安全与隐私**

- [ ] API key 只存 SecretStorage，不打印、不写日志、不进 settings/URL
- [ ] 排除 glob 生效，`.env` 等不上传
- [ ] 日志只记长度/耗时/usage，不记完整 prompt（可选开关）

**质量与性能**

- [ ] TypeScript `strict` 无报错；避免 `any` 泛滥
- [ ] 上下文裁剪在 32k/128k 边界正确，不截断半个 UTF-8 字符
- [ ] 上下文顺序稳定（前缀缓存友好）
- [ ] 模块边界清晰，`extension.ts` 只做接线

**UX**

- [ ] 状态栏"生成中…" / 失败提示 / 无结果提示 / 超时提示
- [ ] Esc 取消、重复触发取消上一次请求
- [ ] 不弹错误弹窗打断写作

**提交**

- [ ] commit 信息符合 `M?: …` 格式
- [ ] tag 与 CHANGELOG 更新
- [ ] main 可编译

## 7. 测试与验收

- **纯函数单测**（D 维护）：`latexCheck`、`mathMode`、`context` 裁剪、`postprocess`。用 `node --test tests/*.test.mjs`（先 `npm run compile`，测试直接 import `out/*.js`）。
- **接口契约测试**：`chatClient` 注入可替换的 `fetch`（依赖注入），测试参数构造与错误映射，不发真实请求。
- **fixtures**：`tests/fixtures/notes.md`、`tests/fixtures/paper.tex`，覆盖行内/行间/环境/选区/长文档。
- **手动验收**（你）：VS Code 按 `F5` 进开发宿主；或 `npm run package` 出 vsix 安装。检查 ghost text、Tab、Esc、逐词接受、超时表现。
- **bench**（可选）：`DEEPSEEK_API_KEY=... npm run bench` 测 32k 上下文的 TTFT/总耗时，验证 max 档延迟。

## 8. 风险与回滚

- max 档延迟可能 10–60 秒：属于预期；设置项可切 `none`，无需改代码。状态栏加计时显示。
- 语法检查误判风险：先做"只拦明显坏"的规则；测试用例覆盖。
- notebook 兼容性未知：M5 先验证，不行降级为"快捷键直接插入"。
- 每 milestone 有 tag；出问题回滚到上一个 tag。

## 9. 时间估算

| 阶段 | 估时 |
| --- | --- |
| M1 | 1–2 天 |
| M2 | 0.5–1 天 |
| M3 | 0.5–1 天 |
| M4 | 1 天 |
| M5 | 1–2 天 |
| 合计 | 约 4–7 天（按每天有效开发时间算） |

## 10. 待确认

1. 以上流程、分工、里程碑划分是否 OK？
2. 每个 milestone 完成后是按"你验收 → 我再提交远程"还是"先提交远程再由你验收"？我建议**先本地验收通过再 push**，远程 main 始终干净。
3. 是否同意 M1 用"最小闭环"范围（不做选区、不做语法检查、只做基础行内/行间）？
