import * as vscode from 'vscode';
import { CodememClient, Session } from '../api/client';

// ── Tree nodes ────────────────────────────────────────────────────────────

export class SessionNode extends vscode.TreeItem {
  constructor(public readonly session: Session) {
    const date = new Date(session.started_at);
    const label = `${session.namespace || '(global)'} — ${formatDate(date)}`;
    super(
      label,
      session.summary
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.contextValue = 'session';
    this.description = session.memory_count
      ? `${session.memory_count} memories`
      : undefined;
    this.iconPath = new vscode.ThemeIcon(
      session.ended_at ? 'check-all' : 'loading~spin',
    );
    this.tooltip = new vscode.MarkdownString(
      `**Session** \`${session.id.slice(0, 8)}\`\n\n` +
        `Namespace: ${session.namespace || '(global)'}\n` +
        `Started: ${date.toLocaleString()}\n` +
        (session.ended_at
          ? `Ended: ${new Date(session.ended_at).toLocaleString()}\n`
          : '*Active*\n') +
        `Memories: ${session.memory_count}\n` +
        (session.summary ? `\n---\n${session.summary}` : ''),
    );
  }
}

export class SummaryNode extends vscode.TreeItem {
  constructor(summary: string) {
    super(truncate(summary, 80), vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('comment');
    this.tooltip = summary;
  }
}

type SessionTreeItem = SessionNode | SummaryNode;

// ── Provider ─────────────────────────────────────────────────────────────

export class SessionsProvider
  implements vscode.TreeDataProvider<SessionTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    SessionTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private sessions: Session[] = [];

  constructor(private client: CodememClient) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SessionTreeItem): Promise<SessionTreeItem[]> {
    if (element instanceof SessionNode && element.session.summary) {
      return [new SummaryNode(element.session.summary)];
    }

    try {
      const config = vscode.workspace.getConfiguration('codemem');
      const ns = resolveNamespace(config.get<string>('namespace', ''));
      this.sessions = await this.client.listSessions({ namespace: ns, limit: 30 });
    } catch {
      this.sessions = [];
    }

    if (this.sessions.length === 0) {
      const empty = new vscode.TreeItem('No sessions recorded yet');
      empty.iconPath = new vscode.ThemeIcon('info');
      return [empty as SessionTreeItem];
    }

    return this.sessions.map((s) => new SessionNode(s));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const hours = diff / 3_600_000;
  if (hours < 24) { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  if (hours < 168) { return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }); }
  return d.toLocaleDateString();
}

function truncate(s: string, len: number): string {
  const trimmed = s.replace(/\s+/g, ' ').trim();
  return trimmed.length > len ? trimmed.slice(0, len - 1) + '…' : trimmed;
}

function resolveNamespace(configured: string): string | undefined {
  if (configured) { return configured; }
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) { return folders[0].name; }
  return undefined;
}
