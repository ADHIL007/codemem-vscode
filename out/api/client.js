"use strict";
// CodeMem REST API client
// Talks to the codemem serve --api server (default port 4242)
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodememClient = void 0;
class CodememClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }
    setBaseUrl(url) {
        this.baseUrl = url.replace(/\/$/, '');
    }
    async request(path, options) {
        const url = `${this.baseUrl}${path}`;
        const res = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options?.headers ?? {}),
            },
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
        }
        return res.json();
    }
    async health() {
        try {
            const res = await fetch(`${this.baseUrl}/api/health`);
            return res.ok;
        }
        catch {
            return false;
        }
    }
    async getStats() {
        return this.request('/api/stats');
    }
    async listMemories(opts = {}) {
        const p = new URLSearchParams();
        if (opts.namespace) {
            p.set('namespace', opts.namespace);
        }
        if (opts.type) {
            p.set('type', opts.type);
        }
        if (opts.limit !== undefined) {
            p.set('limit', String(opts.limit));
        }
        if (opts.offset !== undefined) {
            p.set('offset', String(opts.offset));
        }
        const qs = p.toString();
        return this.request(`/api/memories${qs ? `?${qs}` : ''}`);
    }
    async getMemory(id) {
        return this.request(`/api/memories/${id}`);
    }
    async storeMemory(opts) {
        const data = await this.request('/api/memories', {
            method: 'POST',
            body: JSON.stringify({
                content: opts.content,
                memory_type: opts.memory_type,
                tags: opts.tags ?? [],
                namespace: opts.namespace,
                importance: opts.importance ?? 0.5,
            }),
        });
        return data.id;
    }
    async deleteMemory(id) {
        await fetch(`${this.baseUrl}/api/memories/${id}`, { method: 'DELETE' });
    }
    async search(opts) {
        const p = new URLSearchParams({ q: opts.query });
        if (opts.namespace) {
            p.set('namespace', opts.namespace);
        }
        if (opts.k !== undefined) {
            p.set('k', String(opts.k));
        }
        if (opts.type) {
            p.set('type', opts.type);
        }
        const data = await this.request(`/api/search?${p.toString()}`);
        return data.results ?? [];
    }
    async listSessions(opts = {}) {
        const p = new URLSearchParams();
        if (opts.namespace) {
            p.set('namespace', opts.namespace);
        }
        if (opts.limit !== undefined) {
            p.set('limit', String(opts.limit));
        }
        const qs = p.toString();
        return this.request(`/api/sessions${qs ? `?${qs}` : ''}`);
    }
    async listNamespaces() {
        return this.request('/api/namespaces');
    }
    // ── Repository Management ──────────────────────────────────────────────
    async listRepos() {
        return this.request('/api/repos');
    }
    async registerRepo(opts) {
        const data = await this.request('/api/repos', {
            method: 'POST',
            body: JSON.stringify({ path: opts.path, name: opts.name ?? opts.path }),
        });
        return data.id;
    }
    async deleteRepo(id) {
        await fetch(`${this.baseUrl}/api/repos/${id}`, { method: 'DELETE' });
    }
    async indexRepo(id) {
        const data = await this.request(`/api/repos/${id}/index`, {
            method: 'POST',
        });
        return data.message;
    }
    async analyzeRepo(id) {
        const data = await this.request(`/api/repos/${id}/analyze`, {
            method: 'POST',
        });
        return data.message;
    }
    async ingestLocalEdges(namespace, edges) {
        return this.request('/api/graph/ingest-local-edges', {
            method: 'POST',
            body: JSON.stringify({ namespace, edges }),
        });
    }
    async getRepo(id) {
        return this.request(`/api/repos/${id}`);
    }
}
exports.CodememClient = CodememClient;
//# sourceMappingURL=client.js.map