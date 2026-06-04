import * as vscode from 'vscode';
import { CodememClient, Memory, Stats } from '../api/client';

const MEMORY_TYPES = [
  'decision',
  'pattern',
  'preference',
  'style',
  'habit',
  'insight',
  'context',
];

// ── Tree nodes ────────────────────────────────────────────────────────────

export class StatusHeaderNode extends vscode.TreeItem {
  constructor(
    public readonly connected: boolean,
    public readonly serverUrl: string,
    public readonly stats?: Stats,
  ) {
    const label = connected ? '● Connected' : '○ Disconnected';
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'statusHeader';

    if (connected && stats) {
      this.description = `${stats.memory_count} memories · ${stats.node_count} nodes · ${stats.edge_count} edges`;
      this.tooltip = new vscode.MarkdownString(
        `**Connected** to \`${serverUrl}\`\n\n` +
          `| Metric | Value |\n|---|---|\n` +
          `| Memories | ${stats.memory_count} |\n` +
          `| Embeddings | ${stats.embedding_count} |\n` +
          `| Graph Nodes | ${stats.node_count} |\n` +
          `| Graph Edges | ${stats.edge_count} |\n` +
          `| Sessions | ${stats.session_count} |\n` +
          `| Namespaces | ${stats.namespace_count} |`,
      );
      this.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
    } else if (connected) {
      this.description = serverUrl;
      this.tooltip = `Connected to ${serverUrl}`;
      this.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
    } else {
      this.description = 'Click to connect';
      this.tooltip = 'Not connected to CodeMem server. Click to connect.';
      this.iconPath = new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('testing.iconFailed'));
      this.command = {
        command: 'codemem.connect',
        title: 'Connect',
      };
    }
  }
}

export class ProgressLogNode extends vscode.TreeItem {
  constructor(public readonly line: string) {
    super(line, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'progressLog';
    this.iconPath = new vscode.ThemeIcon('circle-small-filled');
  }
}

export class ProgressNode extends vscode.TreeItem {
  public logs: ProgressLogNode[] = [];
  constructor(
    public readonly message: string,
    public readonly detail?: string,
  ) {
    super(message, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'progressNode';
    this.description = detail;
    this.iconPath = new vscode.ThemeIcon('loading~spin');
  }
}

export class DoctorCheckNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly passed: boolean,
    public readonly detail?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'doctorCheck';
    this.description = detail;
    this.iconPath = passed
      ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
      : new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
  }
}

export class DoctorGroupNode extends vscode.TreeItem {
  constructor(
    public readonly checks: DoctorCheckNode[],
    public readonly allPassed: boolean,
  ) {
    const passing = checks.filter((c) => c.passed).length;
    super(
      allPassed ? `✓ All checks passed (${passing}/${checks.length})` : `⚠ ${checks.length - passing} check(s) failed`,
      vscode.TreeItemCollapsibleState.Expanded,
    );
    this.contextValue = 'doctorGroup';
    this.iconPath = allPassed
      ? new vscode.ThemeIcon('shield', new vscode.ThemeColor('testing.iconPassed'))
      : new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
  }
}

export class MemoryTypeGroup extends vscode.TreeItem {
  constructor(
    public readonly typeName: string,
    public readonly count: number,
    public readonly memories: MemoryNode[],
  ) {
    super(
      `${capitalize(typeName)} (${count})`,
      count > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.contextValue = 'memoryGroup';
    this.iconPath = new vscode.ThemeIcon(typeIcon(typeName));
    this.description = count === 0 ? 'empty' : undefined;
  }
}

export class MemoryNode extends vscode.TreeItem {
  constructor(public readonly memory: Memory) {
    const label = truncate(memory.content, 60);
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'memory';
    this.tooltip = new vscode.MarkdownString(
      `**${capitalize(memory.memory_type)}** · importance ${memory.importance.toFixed(2)}\n\n` +
        `${memory.content}\n\n` +
        (memory.tags.length ? `*Tags: ${memory.tags.join(', ')}*\n\n` : '') +
        `*Namespace: ${memory.namespace || '(global)'}*\n` +
        `*ID: ${memory.id}*`,
    );
    this.description = memory.tags.length ? memory.tags.slice(0, 3).join(', ') : undefined;
    this.iconPath = new vscode.ThemeIcon('circle-small-filled');
    // Open memory details on click
    this.command = {
      command: 'codemem.showMemoryDetail',
      title: 'Show Memory',
      arguments: [memory],
    };
  }
}

type MemoryTreeItem =
  | StatusHeaderNode
  | ProgressNode
  | ProgressLogNode
  | DoctorGroupNode
  | DoctorCheckNode
  | MemoryTypeGroup
  | MemoryNode
  | vscode.TreeItem;

// ── Provider ─────────────────────────────────────────────────────────────

export class MemoriesProvider
  implements vscode.TreeDataProvider<MemoryTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    MemoryTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private groups: MemoryTypeGroup[] = [];
  private loading = false;
  private error: string | undefined;
  private connected = false;
  private stats: Stats | undefined;

  // Cached last-known state — used for instant re-renders during progress
  private cachedStatusNode: StatusHeaderNode | undefined;
  private cachedServerUrl = 'http://localhost:4242';

  // Progress overlay (set while analyze is running)
  private progressNode: ProgressNode | undefined;

  // Doctor results (set after doctor run, cleared on next refresh)
  private doctorGroup: DoctorGroupNode | undefined;

  // Max log lines kept in tree
  private static MAX_LOGS = 30;

  constructor(private client: CodememClient) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setConnectionStatus(connected: boolean, stats?: Stats): void {
    this.connected = connected;
    this.stats = stats;
    this._onDidChangeTreeData.fire();
  }

  /** Called by analyzeWorkspace command to show a spinner above memories */
  setProgress(message: string | undefined, detail?: string): void {
    if (message) {
      const logs = this.progressNode?.logs ?? [];
      this.progressNode = new ProgressNode(message, detail);
      this.progressNode.logs = logs;
    } else {
      this.progressNode = undefined;
    }
    // Fire without resetting the loading flag — returns cached state instantly
    this._onDidChangeTreeData.fire();
  }

  /** Append a log line under the progress spinner */
  appendProgressLog(line: string): void {
    if (!this.progressNode) { return; }
    this.progressNode.logs.push(new ProgressLogNode(line));
    // Keep only the last MAX_LOGS entries
    if (this.progressNode.logs.length > MemoriesProvider.MAX_LOGS) {
      this.progressNode.logs = this.progressNode.logs.slice(-MemoriesProvider.MAX_LOGS);
    }
    this._onDidChangeTreeData.fire();
  }

  /** Called by doctor command to show check results above memories */
  setDoctorResults(checks: DoctorCheckNode[]): void {
    const allPassed = checks.every((c) => c.passed);
    this.doctorGroup = new DoctorGroupNode(checks, allPassed);
    this._onDidChangeTreeData.fire();
  }

  clearDoctorResults(): void {
    this.doctorGroup = undefined;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: MemoryTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: MemoryTreeItem): Promise<MemoryTreeItem[]> {
    if (element instanceof MemoryTypeGroup) {
      return element.memories;
    }
    if (element instanceof DoctorGroupNode) {
      return element.checks;
    }
    if (element instanceof ProgressNode) {
      return element.logs;
    }

    // If analysis is running, return cached state immediately (no server re-fetch)
    if (this.progressNode) {
      const statusNode = this.cachedStatusNode ?? new StatusHeaderNode(false, this.cachedServerUrl);
      const topExtras: MemoryTreeItem[] = [this.progressNode];
      if (this.doctorGroup) { topExtras.push(this.doctorGroup); }
      return this.groups.length > 0
        ? [statusNode, ...topExtras, ...this.groups]
        : [statusNode, ...topExtras];
    }

    // Root: status header + optional progress/doctor + groups
    if (this.loading) {
      return [];
    }
    this.loading = true;

    this.cachedServerUrl = vscode.workspace.getConfiguration('codemem').get<string>('serverUrl', 'http://localhost:4242');

    // Check connection and get stats
    try {
      const ok = await this.client.health();
      this.connected = ok;
      if (ok) {
        this.stats = await this.client.getStats();
      }
    } catch {
      this.connected = false;
      this.stats = undefined;
    }

    const statusNode = new StatusHeaderNode(this.connected, this.cachedServerUrl, this.stats);
    this.cachedStatusNode = statusNode;

    if (!this.connected) {
      this.loading = false;
      const extras: MemoryTreeItem[] = [];
      if (this.doctorGroup) { extras.push(this.doctorGroup); }
      return [statusNode, ...extras];
    }

    try {
      const config = vscode.workspace.getConfiguration('codemem');
      const ns = resolveNamespace(config.get<string>('namespace', ''));
      const limit = config.get<number>('memoriesPerPage', 50);

      const { memories } = await this.client.listMemories({ namespace: ns, limit });
      this.groups = buildGroups(memories);
      this.error = undefined;
    } catch (err: unknown) {
      this.error = String(err);
      this.groups = [];
    } finally {
      this.loading = false;
    }

    if (this.error) {
      const item = new vscode.TreeItem(`Error: ${this.error}`);
      item.iconPath = new vscode.ThemeIcon('error');
      const extras: MemoryTreeItem[] = [];
      if (this.progressNode) { extras.push(this.progressNode); }
      if (this.doctorGroup) { extras.push(this.doctorGroup); }
      return [statusNode, ...extras, item];
    }

    const topExtras: MemoryTreeItem[] = [];
    if (this.progressNode) { topExtras.push(this.progressNode); }
    if (this.doctorGroup) { topExtras.push(this.doctorGroup); }

    if (this.groups.length === 0) {
      const empty = new vscode.TreeItem('No memories stored yet');
      empty.iconPath = new vscode.ThemeIcon('info');
      return [statusNode, ...topExtras, empty];
    }

    return [statusNode, ...topExtras, ...this.groups];
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function buildGroups(memories: Memory[]): MemoryTypeGroup[] {
  const byType = new Map<string, Memory[]>();

  for (const m of memories) {
    const t = m.memory_type || 'context';
    if (!byType.has(t)) { byType.set(t, []); }
    byType.get(t)!.push(m);
  }

  const orderedTypes = [
    ...MEMORY_TYPES.filter((t) => byType.has(t)),
    ...[...byType.keys()].filter((t) => !MEMORY_TYPES.includes(t)),
  ];

  return orderedTypes
    .map((t) => {
      const mems = byType.get(t)!;
      const nodes = mems
        .sort((a, b) => b.importance - a.importance)
        .map((m) => new MemoryNode(m));
      return new MemoryTypeGroup(t, mems.length, nodes);
    })
    .filter((g) => g.count > 0);
}

function typeIcon(type: string): string {
  const icons: Record<string, string> = {
    decision: 'law',
    pattern: 'symbol-snippet',
    preference: 'settings-gear',
    style: 'symbol-color',
    habit: 'sync',
    insight: 'lightbulb',
    context: 'note',
  };
  return icons[type] ?? 'database';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function truncate(s: string, len: number): string {
  const trimmed = s.replace(/\s+/g, ' ').trim();
  return trimmed.length > len ? trimmed.slice(0, len - 1) + '…' : trimmed;
}

export function resolveNamespace(configured: string): string | undefined {
  if (configured) { return configured; }
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].name;
  }
  return undefined;
}
