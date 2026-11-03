import * as vscode from 'vscode';

export function log(channel: vscode.OutputChannel, message: string) {
  channel.appendLine(`[${new Date().toISOString()}] ${message}`);
}
