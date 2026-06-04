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
exports.SessionsProvider = exports.SummaryNode = exports.SessionNode = void 0;
const vscode = __importStar(require("vscode"));
// ── Tree nodes ────────────────────────────────────────────────────────────
class SessionNode extends vscode.TreeItem {
    constructor(session) {
        const date = new Date(session.started_at);
        const label = `${session.namespace || '(global)'} — ${formatDate(date)}`;
        super(label, session.summary
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None);
        this.session = session;
        this.contextValue = 'session';
        this.description = session.memory_count
            ? `${session.memory_count} memories`
            : undefined;
        this.iconPath = new vscode.ThemeIcon(session.ended_at ? 'check-all' : 'loading~spin');
        this.tooltip = new vscode.MarkdownString(`**Session** \`${session.id.slice(0, 8)}\`\n\n` +
            `Namespace: ${session.namespace || '(global)'}\n` +
            `Started: ${date.toLocaleString()}\n` +
            (session.ended_at
                ? `Ended: ${new Date(session.ended_at).toLocaleString()}\n`
                : '*Active*\n') +
            `Memories: ${session.memory_count}\n` +
            (session.summary ? `\n---\n${session.summary}` : ''));
    }
}
exports.SessionNode = SessionNode;
class SummaryNode extends vscode.TreeItem {
    constructor(summary) {
        super(truncate(summary, 80), vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('comment');
        this.tooltip = summary;
    }
}
exports.SummaryNode = SummaryNode;
// ── Provider ─────────────────────────────────────────────────────────────
class SessionsProvider {
    constructor(client) {
        this.client = client;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.sessions = [];
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (element instanceof SessionNode && element.session.summary) {
            return [new SummaryNode(element.session.summary)];
        }
        try {
            const config = vscode.workspace.getConfiguration('codemem');
            const ns = resolveNamespace(config.get('namespace', ''));
            this.sessions = await this.client.listSessions({ namespace: ns, limit: 30 });
        }
        catch {
            this.sessions = [];
        }
        if (this.sessions.length === 0) {
            const empty = new vscode.TreeItem('No sessions recorded yet');
            empty.iconPath = new vscode.ThemeIcon('info');
            return [empty];
        }
        return this.sessions.map((s) => new SessionNode(s));
    }
}
exports.SessionsProvider = SessionsProvider;
// ── Helpers ───────────────────────────────────────────────────────────────
function formatDate(d) {
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const hours = diff / 3600000;
    if (hours < 24) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (hours < 168) {
        return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString();
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
//# sourceMappingURL=sessionsProvider.js.map