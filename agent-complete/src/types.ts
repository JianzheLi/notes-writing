export type FormulaStyle = 'auto' | 'inline' | 'display';
export type ReasoningEffort = 'none' | 'low' | 'high' | 'max';
export type FormulaMode =
  | 'auto'
  | 'inline'
  | 'display'
  | 'continue-inline'
  | 'continue-display';

export interface MathContext {
  mode: FormulaMode;
  insideMath: boolean;
  reason: string;
  /** 光标所在的数学环境名（例如 equation / align*）。 */
  environment?: string;
}

export interface CodeContext {
  prefix: string;
  suffix: string;
  section: string;
  lineBefore: string;
  /** 选区文字（仅在有选区时存在），作为公式描述传给模型。 */
  selection?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProxyChoice {
  url: string;
  source: string;
}

export interface ChatOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  messages: ChatMessage[];
  signal: AbortSignal;
  /** 按顺序尝试的代理候选；为空表示本机没有代理配置，直连（与其它程序一致）。 */
  proxies?: ProxyChoice[];
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  cacheHitTokens?: number;
}

export interface ChatResult {
  content: string;
  usage: ChatUsage;
  elapsedMs: number;
  proxyUsed?: string;
  proxySource?: string;
}
