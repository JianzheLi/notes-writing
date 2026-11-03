import * as vscode from 'vscode';
import { complete } from './fimClient';
import { buildContext, isExcluded } from './context';
import { postProcess } from './postprocess';
import { log } from './log';

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
        prompt: '粘贴 DeepSeek Platform 的 API key（保存在 VS Code SecretStorage，不会写进配置文件）',
        password: true,
        ignoreFocusOut: true,
      });
      if (!key) return;
      await context.secrets.store(SECRET_KEY, key.trim());
      vscode.window.showInformationMessage('Agent Complete：API key 已保存。');
    }),
  );

  // 只负责把手动触发算好的结果交给 VS Code 渲染 ghost text。
  // 打字时的自动触发（Automatic）一律忽略。
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

  context.subscriptions.push(
    vscode.commands.registerCommand('agentComplete.trigger', async () => {
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
          '$(shield) Agent Complete：该文件在排除列表中，不会上传代码',
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

      const codeContext = buildContext(
        document,
        position,
        config.get<number>('contextTokens', 8000),
      );
      const versionAtTrigger = document.version;
      const startedAt = Date.now();
      const status = vscode.window.setStatusBarMessage(
        '$(sync~spin) Agent Complete 生成中…',
      );

      try {
        const result = await complete({
          apiKey,
          baseUrl: config.get<string>('baseUrl', 'https://api.deepseek.com/beta'),
          model: config.get<string>('model', 'deepseek-flash'),
          prompt: codeContext.prefix,
          suffix: codeContext.suffix,
          maxTokens: config.get<number>('maxTokens', 128),
          temperature: config.get<number>('temperature', 0.2),
          timeoutMs: config.get<number>('timeoutMs', 8000),
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        const text = postProcess(result.text);
        const elapsed = Date.now() - startedAt;
        log(
          out,
          `完成 ${elapsed}ms | 上下文 ${codeContext.prefix.length + codeContext.suffix.length} 字符` +
            ` | 输出 ${text.length} 字符 | usage=${JSON.stringify(result.usage)}`,
        );

        if (document.version !== versionAtTrigger) {
          vscode.window.setStatusBarMessage(
            '$(circle-slash) Agent Complete：文档已变化，补全已丢弃',
            2500,
          );
          return;
        }

        const stillSameTarget =
          vscode.window.activeTextEditor === editor &&
          editor.selection.active.isEqual(position);
        if (!stillSameTarget) {
          vscode.window.setStatusBarMessage(
            '$(circle-slash) Agent Complete：光标已移动，补全已丢弃',
            2500,
          );
          return;
        }

        if (!text) {
          vscode.window.setStatusBarMessage(
            '$(circle-slash) Agent Complete：模型没有给出补全',
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
        status.dispose();
        await vscode.commands.executeCommand(
          'editor.action.inlineSuggest.trigger',
          { explicit: true },
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        log(out, `失败 ${Date.now() - startedAt}ms | ${message}`);
        vscode.window.setStatusBarMessage(
          `$(error) Agent Complete 失败：${message.slice(0, 140)}`,
          5000,
        );
      } finally {
        status.dispose();
        if (inflight === controller) inflight = undefined;
      }
    }),
  );

  context.subscriptions.push({
    dispose: () => inflight?.abort(),
  });
}

export function deactivate() {
  inflight?.abort();
  inflight = undefined;
  pending = undefined;
}
