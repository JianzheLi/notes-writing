import * as vscode from 'vscode';
import { resolveApiKey } from './apiKey';
import { cachePercent, getLastRequest } from './lastRequest';
import { FormulaStyle, ReasoningEffort } from './types';

const MODELS = ['deepseek-flash', 'deepseek-v4-pro'] as const;
const EFFORTS: ReasoningEffort[] = ['none', 'low', 'high', 'max'];
const STYLES: FormulaStyle[] = ['auto', 'inline', 'display'];
const CONFIG_KEYS = new Set([
  'model',
  'reasoningEffort',
  'formulaStyle',
  'contextTokens',
]);
const RUN_COMMANDS = new Set(['trigger', 'triggerInline', 'triggerDisplay']);

interface PanelState {
  model: string;
  effort: ReasoningEffort;
  style: FormulaStyle;
  contextTokens: number;
  apiKeySource: string;
  apiKeyFile: string;
  version: string;
  lastRequest?: {
    elapsedMs: number;
    attempts: number;
    mode: string;
    style: string;
    cachePercent?: number;
    cacheHitTokens?: number;
    promptTokens?: number;
  };
}

/**
 * 左侧 Activity Bar 的控制台（webview view）。
 * 只做控制器：改设置、设置 key、触发命令；实际生成仍走 agentComplete.trigger。
 */
export class ControlPanel
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private readonly views = new Set<vscode.WebviewView>();
  private readonly context: vscode.ExtensionContext;
  private readonly out: vscode.OutputChannel;

  constructor(context: vscode.ExtensionContext, out: vscode.OutputChannel) {
    this.context = context;
    this.out = out;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.views.add(view);
    view.webview.options = { enableScripts: true };
    view.webview.html = buildHtml();

    const messageSubscription = view.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    });
    view.onDidChangeVisibility(() => {
      if (view.visible) void this.refresh();
    });
    view.onDidDispose(() => {
      messageSubscription.dispose();
      this.views.delete(view);
    });

    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.views.size === 0) return;
    const state = await this.getState();
    await Promise.all(
      [...this.views].map(async (view) => {
        try {
          await view.webview.postMessage({ type: 'state', state });
        } catch {
          // view 可能刚被关闭，忽略。
        }
      }),
    );
  }

  dispose(): void {
    this.views.clear();
  }

  private async getState(): Promise<PanelState> {
    const config = vscode.workspace.getConfiguration('agentComplete');
    const keyInfo = await resolveApiKey(this.context);
    return {
      model: config.get<string>('model', 'deepseek-flash'),
      effort: config.get<ReasoningEffort>('reasoningEffort', 'none'),
      style: config.get<FormulaStyle>('formulaStyle', 'auto'),
      contextTokens: config.get<number>('contextTokens', 32000),
      apiKeySource: keyInfo.key ? keyInfo.source ?? '已配置' : '未设置',
      apiKeyFile: config.get<string>('apiKeyFile', 'api.txt'),
      version: String(this.context.extension.packageJSON?.version ?? '0.1.0'),
      lastRequest: (() => {
        const last = getLastRequest();
        if (!last) return undefined;
        return {
          elapsedMs: last.elapsedMs,
          attempts: last.attempts,
          mode: last.mode,
          style: last.style,
          cachePercent: cachePercent(last),
          cacheHitTokens: last.cacheHitTokens,
          promptTokens: last.promptTokens,
        };
      })(),
    };
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') return;
    const data = message as { type?: unknown; key?: unknown; value?: unknown; command?: unknown };
    if (typeof data.type !== 'string') return;

    switch (data.type) {
      case 'ready':
      case 'refresh':
        await this.refresh();
        return;
      case 'setConfig':
        await this.updateConfig(data.key, data.value);
        return;
      case 'setApiKey':
        await vscode.commands.executeCommand('agentComplete.setApiKey');
        await this.refresh();
        return;
      case 'run':
        if (typeof data.command === 'string' && RUN_COMMANDS.has(data.command)) {
          // 点击面板后焦点在 webview；先回到编辑器，生成出的 ghost text 才能直接 Tab 接受。
          await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
          await vscode.commands.executeCommand(`agentComplete.${data.command}`);
        }
        return;
      case 'diagnostics':
        await vscode.commands.executeCommand('agentComplete.diagnostics');
        return;
      case 'showOutput':
        this.out.show(true);
        return;
      case 'openSettings':
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'agentComplete',
        );
        return;
      default:
        return;
    }
  }

  private async updateConfig(key: unknown, value: unknown): Promise<void> {
    if (typeof key !== 'string' || !CONFIG_KEYS.has(key)) return;

    let normalized: string | number;
    if (key === 'model') {
      if (typeof value !== 'string' || !(MODELS as readonly string[]).includes(value)) return;
      normalized = value;
    } else if (key === 'reasoningEffort') {
      if (typeof value !== 'string' || !(EFFORTS as string[]).includes(value)) return;
      normalized = value;
    } else if (key === 'formulaStyle') {
      if (typeof value !== 'string' || !(STYLES as string[]).includes(value)) return;
      normalized = value;
    } else {
      const number = Number(value);
      if (!Number.isFinite(number)) return;
      normalized = Math.max(1000, Math.min(128000, Math.round(number)));
    }

    try {
      await vscode.workspace
        .getConfiguration('agentComplete')
        .update(key, normalized, vscode.ConfigurationTarget.Global);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.setStatusBarMessage(
        `$(error) MATE：保存设置失败（${message.slice(0, 80)}）`,
        4000,
      );
    }
  }
}

function buildHtml(): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 10px;
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: 12px;
      line-height: 1.5;
    }
    h1 { font-size: 13px; margin: 0 0 2px; font-weight: 600; }
    .sub { color: var(--vscode-descriptionForeground); font-size: 11px; margin-bottom: 10px; }
    .card {
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.3));
      border-radius: 6px;
      padding: 9px;
      margin-bottom: 9px;
    }
    .card-title { font-weight: 600; margin-bottom: 6px; }
    label { display: block; margin-bottom: 7px; }
    label:last-child { margin-bottom: 0; }
    label > span { display: block; margin-bottom: 3px; color: var(--vscode-descriptionForeground); }
    select, input {
      width: 100%;
      padding: 4px 6px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px;
      font-family: inherit;
      font-size: 12px;
    }
    input:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    button {
      width: 100%;
      padding: 5px 7px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.primary {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .row .value { color: var(--vscode-descriptionForeground); font-size: 11px; text-align: right; }
    .hint { color: var(--vscode-descriptionForeground); font-size: 11px; margin: 4px 0 7px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 6px; }
    .grid button:first-child { grid-column: 1 / -1; }
    .status { color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 2px; }
    .spaced { margin-top: 5px; }
    .missing { color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <h1>MATE</h1>
  <div class="sub">Cmd+E 公式助手 · 控制台</div>

  <div class="card">
    <div class="card-title">生成设置</div>
    <label>
      <span>模型</span>
      <select id="model">
        <option value="deepseek-flash">deepseek-flash（快 / 便宜）</option>
        <option value="deepseek-v4-pro">deepseek-v4-pro（更强）</option>
      </select>
    </label>
    <label>
      <span>思考强度</span>
      <select id="effort">
        <option value="none">none（不思考，最快）</option>
        <option value="low">low</option>
        <option value="high">high</option>
        <option value="max">max（最慢，质量优先）</option>
      </select>
    </label>
    <label>
      <span>公式样式</span>
      <select id="style">
        <option value="auto">auto（模型判断行内/行间）</option>
        <option value="inline">inline（强制行内）</option>
        <option value="display">display（强制行间）</option>
      </select>
    </label>
    <label>
      <span>上下文预算（tokens）</span>
      <input id="contextTokens" type="number" min="1000" max="128000" step="1000">
    </label>
  </div>

  <div class="card">
    <div class="card-title">API Key</div>
    <div class="row">
      <span>当前来源</span>
      <span class="value" id="apiKeySource">—</span>
    </div>
    <div class="hint" id="apiKeyFileHint">查找文件与来源</div>
    <button class="primary" id="setApiKey">设置 / 更新 API Key</button>
    <button id="refresh" class="spaced" title="只重新读取本地设置与 API Key 来源，不发起网络请求">刷新显示（本地）</button>
    <div class="hint">只重新读取本地配置/Key 文件，不调用 API、不消耗 token。</div>
  </div>

  <div class="card">
    <div class="card-title">上次请求</div>
    <div class="hint" id="lastRequest">暂无（按一次 Cmd+E 后显示）</div>
  </div>

  <div class="card">
    <div class="card-title">操作</div>
    <div class="grid">
      <button class="primary" id="run">生成公式</button>
      <button id="runInline">行内</button>
      <button id="runDisplay">行间</button>
      <button id="diagnostics">网络诊断</button>
      <button id="showOutput">输出面板</button>
      <button id="openSettings">设置页</button>
    </div>
  </div>

  <div class="status" id="status">正在读取状态…</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const $ = (id) => document.getElementById(id);

    vscode.postMessage({ type: 'ready' });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message && message.type === 'state') applyState(message.state);
    });

    function applyState(state) {
      $('model').value = state.model;
      $('effort').value = state.effort;
      $('style').value = state.style;
      $('contextTokens').value = String(state.contextTokens);

      const source = $('apiKeySource');
      source.textContent = state.apiKeySource;
      source.classList.toggle('missing', !state.apiKeySource || state.apiKeySource === '未设置');
      $('apiKeyFileHint').textContent =
        '配置文件：' + state.apiKeyFile +
        '（文件存在时优先；否则 .env → 环境变量 → SecretStorage）';
      $('status').textContent =
        'v' + state.version + ' · ' + state.model +
        ' · 思考 ' + state.effort +
        ' · ' + state.style +
        ' · ' + state.contextTokens + ' tokens';

      const last = state.lastRequest;
      if (last) {
        const cache = last.cachePercent === undefined
          ? 'cache ?'
          : 'cache ' + last.cachePercent + '%';
        $('lastRequest').textContent =
          (last.elapsedMs / 1000).toFixed(1) + 's · ' + cache +
          ' (' + (last.cacheHitTokens || 0) + '/' + (last.promptTokens || 0) + ' tokens)' +
          ' · ' + last.attempts + ' 次 · ' + last.style;
      } else {
        $('lastRequest').textContent = '暂无（按一次 Cmd+E 后显示）';
      }
    }

    function bindSelect(id, key) {
      $(id).addEventListener('change', (event) => {
        vscode.postMessage({ type: 'setConfig', key: key, value: event.target.value });
      });
    }

    bindSelect('model', 'model');
    bindSelect('effort', 'reasoningEffort');
    bindSelect('style', 'formulaStyle');

    $('contextTokens').addEventListener('change', (event) => {
      vscode.postMessage({
        type: 'setConfig',
        key: 'contextTokens',
        value: Number(event.target.value),
      });
    });

    $('setApiKey').addEventListener('click', () => vscode.postMessage({ type: 'setApiKey' }));
    $('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    $('run').addEventListener('click', () => vscode.postMessage({ type: 'run', command: 'trigger' }));
    $('runInline').addEventListener('click', () => vscode.postMessage({ type: 'run', command: 'triggerInline' }));
    $('runDisplay').addEventListener('click', () => vscode.postMessage({ type: 'run', command: 'triggerDisplay' }));
    $('diagnostics').addEventListener('click', () => vscode.postMessage({ type: 'diagnostics' }));
    $('showOutput').addEventListener('click', () => vscode.postMessage({ type: 'showOutput' }));
    $('openSettings').addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
  </script>
</body>
</html>`;
}

function getNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}
