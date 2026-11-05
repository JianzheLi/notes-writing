# MATE 开发进度

- 日期：2026-11-05
- 仓库：https://github.com/JianzheLi/notes-writing
- 分支：`main`；最新里程碑：`m4`（`21b9049`）
- 扩展目录：`agent-complete/`
- 当前名：**MATE** — Markdown Assistant for TeX Equations（2026-11-05 定名）
- 当前版本：`0.1.0`
- 状态：**M0–M4 已完成，M5 未开始；未发布 Marketplace**
- 测试：`npm test` **113/113 通过**；`tsc` 通过

> 2026-11-04 对仓库历史做过一次清理重写（force push）。旧 clone 的 commit hash 会失效，需要重新 clone；`m0`–`m4` tag 已指向重写后的提交。

## 1. 里程碑

| 里程碑 | 状态 | tag | 内容 |
| --- | --- | --- | --- |
| M0 骨架 | 已完成 | `m0`（`7bcaa96`） | 扩展脚手架、计划、DEV-PLAN、Cmd+E 占位 |
| M1 公式最小闭环 | 已完成 | `m1`（`e70d20b`） | Cmd+E → 上下文 → DeepSeek Chat → ghost text；代理跟随、网络诊断 |
| M2 选区与判定 | 已完成 | `m2`（`04d41bb`） | 行内/行间/数学环境判定、选区替换、强制命令、auto 样式、红绿预览 |
| M3 语法检查与错误处理 | 已完成 | `m3`（`24d470b`） | `latexCheck.ts`、失败重试 1 次、错误分类、截断处理 |
| M4 上下文工程 | 已完成 | `m4`（`21b9049`） | 宏定义/小节、长文档开窗、前多后少、缓存命中展示、MATE 重命名 |
| M5 代码模式与发布准备 | 未开始 | — | `.py` FIM 续写、`.ipynb` 验证/降级、bench、README |
| M6 Marketplace | 未开始 | — | publisher、icon、LICENSE、repository、vsix、发布 |
| M7（可选） | 未开始 | — | agent-lite：项目级上下文扩展、可选一次 evaluator |

## 2. 每次修改记录

| 日期 | commit | 改了什么 |
| --- | --- | --- |
| 2026-11-04 | `1b4da73` | 初始化：计划草案 + 未接模型的插件骨架 |
| 2026-11-04 | `32ac17e` | 计划 v0.3：主场景改为“文字描述 → 公式”，Cmd+E，简单语法检查 |
| 2026-11-04 | `e64e34d` | 计划 v0.4：上下文 32k/上限 128k、思考强度选项、公式命令 |
| 2026-11-04 | `7bcaa96` | M0：计划 v0.5、DEV-PLAN、默认 thinking max、配置更新 |
| 2026-11-04 | `1320c3e` | M1：Chat Completions → ghost text；网络始终跟随本机代理 |
| 2026-11-04 | `e70d20b` | 网络与数据流说明（IT / 合规）；m1 tag |
| 2026-11-04 | `1c5ffe9` | M2：选区替换 + 行内/行间/数学环境判定完善 |
| 2026-11-04 | `1a425cc` | 选区红/绿预览 + Tab 确认；auto 交给模型判断 |
| 2026-11-04 | `03984ef` | 修复 VS Code 1.144 `execFile` 的 `StringDecoder` 错误；支持 `api.txt` 自动载入 |
| 2026-11-05 | `c5b8fb0` | API key 支持 `.env` / 环境变量 / SecretStorage 回退 |
| 2026-11-05 | `04d41bb` | M2 验收通过，更新里程碑；m2 tag |
| 2026-11-05 | `1e038cc` | 行尾行间公式不再多空行；选区替换保留两侧空白 |
| 2026-11-05 | `23f41cf` | 侧边栏控制台 + 右下角状态栏；默认思考强度改为 `none` |
| 2026-11-05 | `b03feda` | 控制台“刷新显示（本地）”语义明确：只读本地，不联网 |
| 2026-11-05 | `714cf46` | M3：`latexCheck.ts`、语法检查失败重试 1 次、错误分类 |
| 2026-11-05 | `24d470b` | M3 完成，进入 M4；m3 tag |
| 2026-11-05 | `45149e6` | M4：outline/macros/结构化上下文、缓存指标、重命名 MATE |
| 2026-11-05 | `673b466` | 修复截断重试：`finish_reason=length` 改为调大 `max_tokens`，不再同参数重试 |
| 2026-11-05 | `21b9049` | 新增 `paper/` 调研；修正 public 状态；m4 tag |
| 2026-11-05 | （rename） | 最终定名 **MATE**（Markdown Assistant for TeX Equations）；package name `mate`；内部 ID 暂留 `agentComplete.*` |

## 3. 分阶段变更

### M0（骨架）
- 计划 `PLAN.md`、开发流程 `DEV-PLAN.md`、扩展脚手架、Cmd+E 占位。
- git 身份、远程仓库、tag 规则确定。

### M1（最小闭环）
- `chatClient.ts` / `httpPost.ts` / `proxy.ts` / `context.ts` / `prompt.ts` / `postprocess.ts`。
- 网络层用 Node `https.request`，按 `agentComplete.proxy` → `http.proxy` → 环境变量 → macOS 系统代理依次尝试；全部失败不会偷偷直连。
- 网络诊断命令；API key 存 SecretStorage。
- 修复 VS Code 1.144 里 `execFile` 的 `StringDecoder is not a constructor`（系统代理探测改为 `encoding: 'buffer'`）。

### M2（选区与判定）
- 新增 `mathScan.ts`：`$...$`、`$$...$$`、`\[...\]`、`\(...\)`、数学环境白名单、LaTeX 注释、Markdown 代码块、转义、金额/未闭合 `$` 等。
- 选区替换先做红/绿预览（`Tab` 接受 / `Esc` 取消），不再直接改文档；行内替换保留两侧空白。
- `formulaStyle=auto` 不再硬判“行尾=行间”，交给模型看上下文；保留 `inline` / `display` 强制命令。
- 行尾行间公式多空行修复。
- 侧边栏控制台 + 右下角状态栏入口（模型 / effort / style / 上下文预算 / API key / 生成按钮）。
- 默认思考强度从 `max` 改为 `none`。

### M3（语法检查与错误处理）
- 新增 `latexCheck.ts`：`$` 定界符、`{}` 平衡、`\left/\right` 数量、`\begin/\end` 配对；忽略 `\$`、`\{`、`\}` 等转义。
- 检查失败把具体 issue 追加给模型，重试 1 次；仍失败则不显示 ghost text / 选区预览。
- 错误分类：超时 / 网络 / HTTP 401/429/5xx / 空结果 / 截断。
- 截断重试后续修正为：`max_tokens` 翻倍（上限 16384）重试一次，仍截断则放弃；其它非 `stop` 原因直接放弃。

### M4（上下文工程）
- 新增 `outline.ts`：Markdown/LaTeX 当前小节路径，忽略代码块/注释。
- 新增 `macros.ts`：抽取 `\newcommand` / `\DeclareMathOperator` / `\def` 等，去重、按预算截断。
- `context.ts`：
  - 短文档保持完整 prefix/suffix；
  - 长文档只发“宏定义 + 当前小节 + 光标附近前文 + 后文”，中间加省略标记；
  - 前文占剩余预算 90%，后文 10%；
  - 选区描述移到后文之后，prefix 更稳定。
- `lastRequest.ts` + 控制台 + 右下角状态栏：显示耗时、cache 命中数/百分比、attempts。
- `package.json` / displayName / 命令分类 / 文档改为 MATE；内部命令/设置 ID 仍是 `agentComplete.*`。
- 新增 `paper/` 调研：agent 架构、提示词/上下文工程、设计评审。

## 4. 验证方式

```bash
cd agent-complete
npm run compile
npm test              # 113 个纯函数单测
```

手工验收：
1. VS Code 打开 `agent-complete` 文件夹，`F5` 启动扩展开发宿主。
2. `Cmd+Shift+P` → `MATE: 设置 DeepSeek API Key`，或用仓库根目录 `api.txt` / `.env` / `DEEPSEEK_API_KEY`。
3. 在 `.md`/`.tex` 里写描述，`Cmd+E`；`Tab` 接受 ghost text/选区预览，`Esc` 取消。
4. 控制台和右下角查看 `cache` 命中；输出面板看 `section=` / `macros=` / `finish=` / usage。
5. 长文档、含 `\newcommand` 的文件、选区替换分别验证。

## 5. 已知问题 / 风险

1. **Marketplace 未发布**：`publisher` 仍是 `local`；`vsce package` 仍会因 `@types/vscode ^1.144.0` > `engines.vscode ^1.85.0` 失败，M6 统一修。
2. **没有生成质量评估集**：纯函数单测覆盖不了“公式是否合理”；`paper/design-review.md` 认为这是最大风险，建议 M5 前建 20–30 条 fixture + 盲评。
3. **默认上下文 32k 偏大**：调研建议 8–12k + 末尾短复述，需要 A/B；目前未改（用户更关注前文，估算精度被明确降级）。
4. **内部 ID 未改名**：命令/设置/视图 ID 仍是 `agentComplete.*`，M6 发布前再迁移。
5. **未做 workspace trust 处理**：不可信工作区仍会自动读取上下文并发送；发布前应确认策略。
6. **`.py` / `.ipynb` 未做**：M5。
7. **测试文件**：`agent-complete/scratch.md` 未跟踪；`api.txt`、`.env` 已在 `.gitignore`。
8. **名称已定 MATE**：尚未做 Marketplace 精确重名/商标检索，M6 发布前补。

## 6. 下一步

- **M5（代码模式与发布准备）**：
  - `.py` FIM：`/beta/completions`、非思考、4K 上限；
  - `.py` 的 suffix 预算单独调大（30–50%），且**不要跑 LaTeX 语法检查**；
  - `.ipynb` 验证 ghost text/触发命令，不行降级直接插入；
  - `scripts/bench.mjs` 成体系；README/CHANGELOG 更新。
- **M6（Marketplace）**：
  - publisher、icon、LICENSE、repository、keywords；
  - 对齐 `@types/vscode` 与 `engines.vscode`；
  - `.vscodeignore` 审计（`api.txt`/`.env`/tests 不进包）；
  - 数据使用声明、首次使用引导、无遥测说明；vsix 本地回归后发布。
- **M7（可选）**：agent-lite：项目级确定性上下文扩展（`\input`/跨文件宏/符号表）+ 可选一次 evaluator；不做自主 loop / multi-agent / 向量记忆。

## 7. 名称

**MATE — Markdown Assistant for TeX Equations**（2026-11-05 定名）。

- 4 字母，本身是英文单词 *mate*（伙伴/搭子），同时是描述短语的首字母缩写；
- package name `mate`，displayName `MATE`；控制台、状态栏、README、CHANGELOG 已同步；
- 内部命令/设置/视图 ID 仍保留 `agentComplete.*`，M6 发布前统一迁移（避免现在破坏已有配置/键位）。

命名时排除的候选：

- `TeamMate`：Wolters Kluwer 的审计管理产品（[官网](https://www.wolterskluwer.com/en/solutions/solutions%20bucket/2020/03/13/20/27/teammate)），且 “team” 容易误解为多人协作；
- `TeXMate`：已有同名 AI LaTeX 在线编辑器（[texmate.es](https://texmate.es/)）；
- 其他备选：`TEAM`（Text-to-Equation Assistant for Markdown）、`TAME`、`PEN`、`PLOT`、`NOTE`、`EASE`、`EqMate`、`TeXQuill`、`Notate`、`Lemma`。

尚未做 Marketplace 精确重名检索与商标检索，M6 发布前补。

## 8. 相关文档

- [PLAN.md](PLAN.md)：产品计划
- [DEV-PLAN.md](DEV-PLAN.md)：开发流程、里程碑、分工
- [NETWORK.md](NETWORK.md)：网络与数据流说明
- [agent-complete/README.md](agent-complete/README.md)：使用说明
- [agent-complete/CHANGELOG.md](agent-complete/CHANGELOG.md)：变更日志
- [paper/README.md](paper/README.md)：调研总览
- [paper/design-review.md](paper/design-review.md)：逐项设计评审 + M5/M6/M7 建议
