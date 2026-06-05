"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoriesProvider = exports.MemoryNode = exports.MemoryTypeGroup = exports.DoctorGroupNode = exports.DoctorCheckNode = exports.ProgressNode = exports.ProgressLogNode = exports.ServerHelpNode = exports.StatusHeaderNode = void 0;
exports.resolveNamespace = resolveNamespace;
const vscode = __importStar(require("vscode"));
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
class StatusHeaderNode extends vscode.TreeItem {
    constructor(connected, serverUrl, stats) {
        const label = connected ? '● Connected' : '○ Disconnected';
        super(label, vscode.TreeItemCollapsibleState.None);
        this.connected = connected;
        this.serverUrl = serverUrl;
        this.stats = stats;
        this.contextValue = 'statusHeader';
        if (connected && stats) {
            this.description = `${stats.memory_count} memories · ${stats.node_count} nodes · ${stats.edge_count} edges`;
            this.tooltip = new vscode.MarkdownString(`**Connected** to \`${serverUrl}\`\n\n` +
                `| Metric | Value |\n|---|---|\n` +
                `| Memories | ${stats.memory_count} |\n` +
                `| Embeddings | ${stats.embedding_count} |\n` +
                `| Graph Nodes | ${stats.node_count} |\n` +
                `| Graph Edges | ${stats.edge_count} |\n` +
                `| Sessions | ${stats.session_count} |\n` +
                `| Namespaces | ${stats.namespace_count} |`);
            this.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
        }
        else if (connected) {
            this.description = serverUrl;
            this.tooltip = `Connected to ${serverUrl}`;
            this.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
        }
        else {
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
exports.StatusHeaderNode = StatusHeaderNode;
class ServerHelpNode extends vscode.TreeItem {
    constructor() {
        super('Need a server?', vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'serverHelp';
        this.description = 'Click for setup help';
        this.tooltip = new vscode.MarkdownString(`**Don't have a CodeMem server?**\n\n` +
            `If your organization hasn't configured a CodeMem server, ` +
            `you can install and run one locally from:\n\n` +
            `🔗 [codemem-server-v2](https://github.com/ADHIL007/codemem-server-v2)\n\n` +
            `**Quick start:**\n` +
            '```bash\n' +
            `git clone https://github.com/ADHIL007/codemem-server-v2.git\n` +
            `cd codemem-server-v2\n` +
            '# Follow README for setup\n' +
            '```\n\n' +
            `Then set \`codemem.serverUrl\` in VS Code settings to your server URL.`);
        this.tooltip.isTrusted = true;
        this.iconPath = new vscode.ThemeIcon('question', new vscode.ThemeColor('editorInfo.foreground'));
        this.command = {
            command: 'codemem.installServerHelp',
            title: 'Install Server Help',
        };
    }
}
exports.ServerHelpNode = ServerHelpNode;
class ProgressLogNode extends vscode.TreeItem {
    constructor(line) {
        super(line, vscode.TreeItemCollapsibleState.None);
        this.line = line;
        this.contextValue = 'progressLog';
        this.iconPath = new vscode.ThemeIcon('circle-small-filled');
    }
}
exports.ProgressLogNode = ProgressLogNode;
class ProgressNode extends vscode.TreeItem {
    constructor(message, detail) {
        super(message, vscode.TreeItemCollapsibleState.Expanded);
        this.message = message;
        this.detail = detail;
        this.logs = [];
        this.contextValue = 'progressNode';
        this.description = detail;
        this.iconPath = new vscode.ThemeIcon('loading~spin');
    }
}
exports.ProgressNode = ProgressNode;
class DoctorCheckNode extends vscode.TreeItem {
    constructor(label, passed, detail) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.label = label;
        this.passed = passed;
        this.detail = detail;
        this.contextValue = 'doctorCheck';
        this.description = detail;
        this.iconPath = passed
            ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
            : new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    }
}
exports.DoctorCheckNode = DoctorCheckNode;
class DoctorGroupNode extends vscode.TreeItem {
    constructor(checks, allPassed) {
        const passing = checks.filter((c) => c.passed).length;
        super(allPassed ? `✓ All checks passed (${passing}/${checks.length})` : `⚠ ${checks.length - passing} check(s) failed`, vscode.TreeItemCollapsibleState.Expanded);
        this.checks = checks;
        this.allPassed = allPassed;
        this.contextValue = 'doctorGroup';
        this.iconPath = allPassed
            ? new vscode.ThemeIcon('shield', new vscode.ThemeColor('testing.iconPassed'))
            : new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
    }
}
exports.DoctorGroupNode = DoctorGroupNode;
class MemoryTypeGroup extends vscode.TreeItem {
    constructor(typeName, count, memories) {
        super(`${capitalize(typeName)} (${count})`, count > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None);
        this.typeName = typeName;
        this.count = count;
        this.memories = memories;
        this.contextValue = 'memoryGroup';
        this.iconPath = new vscode.ThemeIcon(typeIcon(typeName));
        this.description = count === 0 ? 'empty' : undefined;
    }
}
exports.MemoryTypeGroup = MemoryTypeGroup;
class MemoryNode extends vscode.TreeItem {
    constructor(memory) {
        const label = truncate(memory.content, 60);
        super(label, vscode.TreeItemCollapsibleState.None);
        this.memory = memory;
        this.contextValue = 'memory';
        this.tooltip = new vscode.MarkdownString(`**${capitalize(memory.memory_type)}** · importance ${memory.importance.toFixed(2)}\n\n` +
            `${memory.content}\n\n` +
            (memory.tags.length ? `*Tags: ${memory.tags.join(', ')}*\n\n` : '') +
            `*Namespace: ${memory.namespace || '(global)'}*\n` +
            `*ID: ${memory.id}*`);
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
exports.MemoryNode = MemoryNode;
// ── Provider ─────────────────────────────────────────────────────────────
class MemoriesProvider {
    constructor(client) {
        this.client = client;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.groups = [];
        this.loading = false;
        this.connected = false;
        this.cachedServerUrl = 'http://localhost:4242';
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    setConnectionStatus(connected, stats) {
        this.connected = connected;
        this.stats = stats;
        this._onDidChangeTreeData.fire();
    }
    /** Called by analyzeWorkspace command to show a spinner above memories */
    setProgress(message, detail) {
        if (message) {
            const logs = this.progressNode?.logs ?? [];
            this.progressNode = new ProgressNode(message, detail);
            this.progressNode.logs = logs;
        }
        else {
            this.progressNode = undefined;
        }
        // Fire without resetting the loading flag — returns cached state instantly
        this._onDidChangeTreeData.fire();
    }
    /** Append a log line under the progress spinner */
    appendProgressLog(line) {
        if (!this.progressNode) {
            return;
        }
        this.progressNode.logs.push(new ProgressLogNode(line));
        // Keep only the last MAX_LOGS entries
        if (this.progressNode.logs.length > MemoriesProvider.MAX_LOGS) {
            this.progressNode.logs = this.progressNode.logs.slice(-MemoriesProvider.MAX_LOGS);
        }
        this._onDidChangeTreeData.fire();
    }
    /** Called by doctor command to show check results above memories */
    setDoctorResults(checks) {
        const allPassed = checks.every((c) => c.passed);
        this.doctorGroup = new DoctorGroupNode(checks, allPassed);
        this._onDidChangeTreeData.fire();
    }
    clearDoctorResults() {
        this.doctorGroup = undefined;
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
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
            const topExtras = [this.progressNode];
            if (this.doctorGroup) {
                topExtras.push(this.doctorGroup);
            }
            return this.groups.length > 0
                ? [statusNode, ...topExtras, ...this.groups]
                : [statusNode, ...topExtras];
        }
        // Root: status header + optional progress/doctor + groups
        if (this.loading) {
            return [];
        }
        this.loading = true;
        this.cachedServerUrl = vscode.workspace.getConfiguration('codemem').get('serverUrl', 'http://localhost:4242');
        // Check connection and get stats
        try {
            const ok = await this.client.health();
            this.connected = ok;
            if (ok) {
                this.stats = await this.client.getStats();
            }
        }
        catch {
            this.connected = false;
            this.stats = undefined;
        }
        const statusNode = new StatusHeaderNode(this.connected, this.cachedServerUrl, this.stats);
        this.cachedStatusNode = statusNode;
        if (!this.connected) {
            this.loading = false;
            const extras = [new ServerHelpNode()];
            if (this.doctorGroup) {
                extras.push(this.doctorGroup);
            }
            return [statusNode, ...extras];
        }
        try {
            const config = vscode.workspace.getConfiguration('codemem');
            const ns = resolveNamespace(config.get('namespace', ''));
            const limit = config.get('memoriesPerPage', 50);
            const { memories } = await this.client.listMemories({ namespace: ns, limit });
            this.groups = buildGroups(memories);
            this.error = undefined;
        }
        catch (err) {
            this.error = String(err);
            this.groups = [];
        }
        finally {
            this.loading = false;
        }
        if (this.error) {
            const item = new vscode.TreeItem(`Error: ${this.error}`);
            item.iconPath = new vscode.ThemeIcon('error');
            const extras = [];
            if (this.progressNode) {
                extras.push(this.progressNode);
            }
            if (this.doctorGroup) {
                extras.push(this.doctorGroup);
            }
            return [statusNode, ...extras, item];
        }
        const topExtras = [];
        if (this.progressNode) {
            topExtras.push(this.progressNode);
        }
        if (this.doctorGroup) {
            topExtras.push(this.doctorGroup);
        }
        if (this.groups.length === 0) {
            const empty = new vscode.TreeItem('No memories stored yet');
            empty.iconPath = new vscode.ThemeIcon('info');
            return [statusNode, ...topExtras, empty];
        }
        return [statusNode, ...topExtras, ...this.groups];
    }
}
exports.MemoriesProvider = MemoriesProvider;
// Max log lines kept in tree
MemoriesProvider.MAX_LOGS = 30;
// ── Helpers ───────────────────────────────────────────────────────────────
function buildGroups(memories) {
    const byType = new Map();
    for (const m of memories) {
        const t = m.memory_type || 'context';
        if (!byType.has(t)) {
            byType.set(t, []);
        }
        byType.get(t).push(m);
    }
    const orderedTypes = [
        ...MEMORY_TYPES.filter((t) => byType.has(t)),
        ...[...byType.keys()].filter((t) => !MEMORY_TYPES.includes(t)),
    ];
    return orderedTypes
        .map((t) => {
        const mems = byType.get(t);
        const nodes = mems
            .sort((a, b) => b.importance - a.importance)
            .map((m) => new MemoryNode(m));
        return new MemoryTypeGroup(t, mems.length, nodes);
    })
        .filter((g) => g.count > 0);
}
function typeIcon(type) {
    const icons = {
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
function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
function truncate(s, len) {
    const trimmed = s.replace(/\s+/g, ' ').trim();
    return trimmed.length > len ? trimmed.slice(0, len - 1) + '…' : trimmed;
}
function resolveNamespace(configured) {
    if (configured) {
        return configured;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        return folders[0].name;
    }
    return undefined;
}
//# sourceMappingURL=memoriesProvider.js.map