import * as vscode from 'vscode';

export class StatusBarManager {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.command = 'codemem.connect';
    this.setDisconnected();
    this.item.show();
  }

  setConnecting(): void {
    this.item.text = '$(loading~spin) CodeMem';
    this.item.tooltip = 'CodeMem: connecting…';
    this.item.backgroundColor = undefined;
  }

  setConnected(url: string): void {
    this.item.text = '$(database) CodeMem';
    this.item.tooltip = `CodeMem: connected to ${url}\nClick to reconnect`;
    this.item.backgroundColor = undefined;
    this.item.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
  }

  setDisconnected(): void {
    this.item.text = '$(database) CodeMem $(warning)';
    this.item.tooltip = 'CodeMem: not connected — click to connect';
    this.item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground',
    );
    this.item.color = undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}
