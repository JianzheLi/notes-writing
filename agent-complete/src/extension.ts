import * as vscode from 'vscode';
import { chatCompletion } from './chatClient';
import { buildContext, isExcluded } from './context';
import { detectMathContext } from './mathMode';
import { buildSuggestion } from './postprocess';
import { buildMessages } from './prompt';
import { log } from './log';
import { httpRequest } from './httpPost';
import { resolveProxyCandidates } from './proxy';
import { FormulaStyle, ProxyChoice, ReasoningEffort } from './types';

const SECRET_KEY = 'agentComplete.deepseekApiKey';

interface PendingSuggestion {
  uri: string;
  version: number;
  position: vscode.Position;
  text: string;
}

let pending: PendingSuggestion | undefined;
let inflight: AbortController | undefined;

export function activate(context: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel('Agent Complete');
  context.subscriptions.push(out);

  context.subscriptions.push(
    vscode.commands.registerCommand('agentComplete.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        title: 'DeepSeek API Key',
        prompt:
          '粘贴 DeepSeek Platform 的 API key（保存在 VS Code SecretStorage，不写进配置文件）',
        password: true,
        ignoreFocusOut: true,
      });
      if (!key) return;
      await context.secrets.store(SECRET_KEY, key.trim());
      vscode.window.showInformationMessage('Agent Complete：API key 已保存。');
    }),
  );

  // 网络诊断：打印代理来源，并用 GET /models 验证连通性（不消耗补全 token）。
  context.subscriptions.push(
    vscode.commands.registerCommand('agentComplete.diagnostics', async () => {
      const config = vscode.workspace.getConfiguration('agentComplete');
      const candidates = await resolveProxyCandidates();
      const envNames = [
        'HTTPS_PROXY',
        'https_proxy',
        'HTTP_PROXY',
        'http_proxy',
        'ALL_PROXY',
        'all_proxy',
      ];
      const envText = envNames
        .filter((name) => process.env[name])
        .map((name) => `${name}=${maskProxy(process.env[name]!)}`)
        .join(', ');

      out.appendLine('===== 网络诊断 =====');
      out.appendLine(
        `agentComplete.proxy = ${maskProxy(config.get<string>('proxy', '')) || '（空）'}`,
      );
      out.appendLine(
        `http.proxy = ${
          maskProxy(
            vscode.workspace.getConfiguration('http').get<string>('proxy', ''),
          ) || '（空）'
        }`,
      );
      out.appendLine(`环境代理变量 = ${envText || '（空）'}`);
      out.appendLine(
        `代理候选 = ${
          candidates
            .map((candidate) => `${candidate.source}:${maskProxy(candidate.url)}`)
            .join(' | ') || '（无，直连）'
        }`,
      );
      out.show(true);

      const apiKey = await context.secrets.get(SECRET_KEY);
      if (!apiKey) {
        out.appendLine('未设置 API key，跳过连通性测试。');
        vscode.window.showInformationMessage(
          'Agent Complete 网络诊断：代理信息已输出到面板（未设置 key，跳过连通性测试）。',
        );
        return;
      }

      const baseUrl = config
        .get<string>('baseUrl', 'https://api.deepseek.com')
        .replace(/\/+$/, '');
      const attempts: Array<ProxyChoice | undefined> =
        candidates.length > 0 ? candidates : [undefined];

      for (const candidate of attempts) {
        const startedAt = Date.now();
        const source = candidate?.source ?? 'direct';
        try {
          const response = await httpRequest({
            method: 'GET',
            url: `${baseUrl}/models`,
            headers: { Authorization: `Bearer ${apiKey}` },
            timeoutMs: 15000,
            signal: new AbortController().signal,
            proxy: candidate?.url,
          });
          const elapsed = Date.now() - startedAt;
          out.appendLine(
            `GET /models via ${source} -> HTTP ${response.status}（${elapsed}ms）`,
          );
          if (response.status >= 200 && response.status < 300) {
            vscode.window.showInformationMessage(
              `Agent Complete 网络诊断：${source} 可用（${elapsed}ms）`,
            );
            return;
          }
        } catch (error) {
          out.appendLine(
            `GET /models via ${source} -> 失败：${describeError(error)}（${Date.now() - startedAt}ms）`,
          );
        }
      }

      vscode.window.showWarningMessage(
        'Agent Complete 网络诊断：所有代理候选都失败，详情见输出面板。',
      );
    }),
  );

  // ghost text provider：只负责把已经算好的结果交给 VS Code，
  // 不在这里发网络请求；打字时的自动触发（Automatic）一律忽略。
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider('*', {
      provideInlineCompletionItems(document, position, ctx) {
        if (ctx.triggerKind !== vscode.InlineCompletionTriggerKind.Invoke) return;
        if (!pending) return;

        const matches =
          pending.uri === document.uri.toString() &&
          pending.version === document.version &&
          pending.position.isEqual(position);

        const suggestion = matches ? pending.text : undefined;
        pending = undefined;
        if (!suggestion) return;

        return [
          new vscode.InlineCompletionItem(
            suggestion,
            new vscode.Range(position, position),
          ),
        ];
      },
    }),
  );

  const run = async (forcedStyle?: FormulaStyle) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const config = vscode.workspace.getConfiguration('agentComplete');

    const languages = config.get<string[]>('languages', []);
    if (!languages.includes(document.languageId)) {
      vscode.window.setStatusBarMessage(
        `$(circle-slash) Agent Complete：当前语言（${document.languageId}）未启用`,
        2500,
      );
      return;
    }

    if (isExcluded(document.uri, config.get<string[]>('excludeGlobs', []))) {
      vscode.window.setStatusBarMessage(
        '$(shield) Agent Complete：该文件在排除列表中，不会上传内容',
        3000,
      );
      return;
    }

    const apiKey = await context.secrets.get(SECRET_KEY);
    if (!apiKey) {
      const choice = await vscode.window.showWarningMessage(
        'Agent Complete：还没有设置 DeepSeek API key。',
        '去设置',
      );
      if (choice === '去设置') {
        await vscode.commands.executeCommand('agentComplete.setApiKey');
      }
      return;
    }

    inflight?.abort();
    const controller = new AbortController();
    inflight = controller;

    const effort = config.get<ReasoningEffort>('reasoningEffort', 'max');
    const style = forcedStyle ?? config.get<FormulaStyle>('formulaStyle', 'auto');
    const math = detectMathContext(document, position, style);
    const codeContext = buildContext(
      document,
      position,
      config.get<number>('contextTokens', 32000),
    );
    const messages = buildMessages({
      fileName: vscode.workspace.asRelativePath(document.uri, false),
      languageId: document.languageId,
      context: codeContext,
      math,
    });

    const versionAtTrigger = document.version;

    // 网络策略：始终跟随本机代理；只有本机完全没有代理配置时才直连。
    const proxyCandidates = await resolveProxyCandidates();

    const startedAt = Date.now();
    log(
      out,
      `请求：${document.languageId} | mode=${math.mode} | effort=${effort} | ` +
        `proxies=${proxyCandidates.map((c) => c.source).join(',') || 'none(direct)'} | ` +
        `上下文 ${codeContext.prefix.length}+${codeContext.suffix.length} 字符`,
    );
    const effortLabel = effort === 'none' ? '快速' : `思考 ${effort}`;
    let status = vscode.window.setStatusBarMessage(
      `$(sync~spin) Agent Complete 生成中（${effortLabel}）…`,
    );
    const ticker = setInterval(() => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      status.dispose();
      status = vscode.window.setStatusBarMessage(
        `$(sync~spin) Agent Complete 生成中（${effortLabel}，${seconds}s）…`,
      );
    }, 1000);

    try {
      const result = await chatCompletion({
        apiKey,
        baseUrl: config.get<string>('baseUrl', 'https://api.deepseek.com'),
        model: config.get<string>('model', 'deepseek-flash'),
        reasoningEffort: effort,
        maxTokens: config.get<number>('maxTokens', 8192),
        temperature: config.get<number>('temperature', 0.2),
        timeoutMs: config.get<number>('timeoutMs', 90000),
        messages,
        signal: controller.signal,
        proxies: proxyCandidates,
      });

      clearInterval(ticker);
      status.dispose();
      if (controller.signal.aborted) return;

      const text = buildSuggestion(result.content, math.mode, codeContext.lineBefore);
      log(
        out,
        `生成 ${result.elapsedMs}ms | mode=${math.mode} | ` +
          `上下文 ${codeContext.prefix.length}+${codeContext.suffix.length} 字符 | ` +
          `输出 ${text.length} 字符 | proxy=${result.proxySource ?? 'direct'} | ` +
          `usage=${JSON.stringify(result.usage)}`,
      );

      if (document.version !== versionAtTrigger) {
        vscode.window.setStatusBarMessage(
          '$(circle-slash) Agent Complete：文档已变化，丢弃这次结果',
          2500,
        );
        return;
      }

      const stillSameTarget =
        vscode.window.activeTextEditor === editor &&
        editor.selection.active.isEqual(position);
      if (!stillSameTarget) {
        vscode.window.setStatusBarMessage(
          '$(circle-slash) Agent Complete：光标已移动，丢弃这次结果',
          2500,
        );
        return;
      }

      if (!text) {
        vscode.window.setStatusBarMessage(
          '$(circle-slash) Agent Complete：模型没有给出公式',
          2500,
        );
        return;
      }

      pending = {
        uri: document.uri.toString(),
        version: document.version,
        position,
        text,
      };
      await vscode.commands.executeCommand(
        'editor.action.inlineSuggest.trigger',
        { explicit: true },
      );
    } catch (error) {
      clearInterval(ticker);
      status.dispose();
      if (controller.signal.aborted) return;
      const message = describeError(error);
      log(
        out,
        `失败 ${Date.now() - startedAt}ms | ${message} | ` +
          `proxyCandidates=${proxyCandidates.map((c) => c.source).join(',') || 'none'}`,
      );
      vscode.window.setStatusBarMessage(
        `$(error) Agent Complete 失败：${message.slice(0, 140)}`,
        5000,
      );
    } finally {
      clearInterval(ticker);
      status.dispose();
      if (inflight === controller) inflight = undefined;
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('agentComplete.trigger', () => run()),
    vscode.commands.registerCommand('agentComplete.triggerInline', () =>
      run('inline'),
    ),
    vscode.commands.registerCommand('agentComplete.triggerDisplay', () =>
      run('display'),
    ),
    { dispose: () => inflight?.abort() },
  );
}

export function deactivate() {
  inflight?.abort();
  inflight = undefined;
  pending = undefined;
}

/** 把 Error 的 cause（如 ENOTFOUND/ECONNREFUSED）也带上，方便诊断网络问题。 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: { code?: string | number; message?: string } })
    .cause;
  const detail = cause?.code ?? cause?.message;
  return detail ? `${error.message}（${detail}）` : error.message;
}

/** 日志里打印代理地址时隐藏用户名/密码。 */
function maskProxy(url: string): string {
  if (!url) return '';
  return url.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^@/]+)@/, '$1***@');
}
