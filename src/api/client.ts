// CodeMem REST API client
// Talks to the codemem serve --api server (default port 4242)

export interface Memory {
  id: string;
  content: string;
  memory_type: string;
  importance: number;
  confidence: number;
  access_count: number;
  tags: string[];
  namespace: string;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  namespace: string;
  started_at: string;
  ended_at?: string;
  memory_count: number;
  summary?: string;
}

export interface SearchResult {
  id: string;
  content: string;
  memory_type: string;
  score: number;
  tags: string[];
  namespace?: string;
}

export interface Stats {
  memory_count: number;
  embedding_count: number;
  node_count: number;
  edge_count: number;
  session_count: number;
  namespace_count: number;
}

export interface Namespace {
  name: string;
  memory_count: number;
}

export interface Repository {
  id: string;
  path: string;
  name: string;
  namespace?: string;
  created_at: string;
  last_indexed_at?: string;
  status: string;
}

export interface LocalEdgeIngestItem {
  src: string;
  dst: string;
  relationship: string;
  file?: string;
  line?: number;
  weight?: number;
}

export interface LocalEdgeIngestResponse {
  nodes_ingested: number;
  edges_ingested: number;
}

export class CodememClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, '');
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
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
    return res.json() as Promise<T>;
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async getStats(): Promise<Stats> {
    return this.request<Stats>('/api/stats');
  }

  async listMemories(opts: {
    namespace?: string;
    type?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ memories: Memory[]; total: number }> {
    const p = new URLSearchParams();
    if (opts.namespace) { p.set('namespace', opts.namespace); }
    if (opts.type) { p.set('type', opts.type); }
    if (opts.limit !== undefined) { p.set('limit', String(opts.limit)); }
    if (opts.offset !== undefined) { p.set('offset', String(opts.offset)); }
    const qs = p.toString();
    return this.request<{ memories: Memory[]; total: number }>(
      `/api/memories${qs ? `?${qs}` : ''}`
    );
  }

  async getMemory(id: string): Promise<Memory> {
    return this.request<Memory>(`/api/memories/${id}`);
  }

  async storeMemory(opts: {
    content: string;
    memory_type: string;
    tags?: string[];
    namespace?: string;
    importance?: number;
  }): Promise<string> {
    const data = await this.request<{ id: string }>('/api/memories', {
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

  async deleteMemory(id: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/memories/${id}`, { method: 'DELETE' });
  }

  async search(opts: {
    query: string;
    namespace?: string;
    k?: number;
    type?: string;
  }): Promise<SearchResult[]> {
    const p = new URLSearchParams({ q: opts.query });
    if (opts.namespace) { p.set('namespace', opts.namespace); }
    if (opts.k !== undefined) { p.set('k', String(opts.k)); }
    if (opts.type) { p.set('type', opts.type); }
    const data = await this.request<{ results: SearchResult[] }>(
      `/api/search?${p.toString()}`
    );
    return data.results ?? [];
  }

  async listSessions(opts: {
    namespace?: string;
    limit?: number;
  } = {}): Promise<Session[]> {
    const p = new URLSearchParams();
    if (opts.namespace) { p.set('namespace', opts.namespace); }
    if (opts.limit !== undefined) { p.set('limit', String(opts.limit)); }
    const qs = p.toString();
    return this.request<Session[]>(
      `/api/sessions${qs ? `?${qs}` : ''}`
    );
  }

  async listNamespaces(): Promise<Namespace[]> {
    return this.request<Namespace[]>('/api/namespaces');
  }

  // ── Repository Management ──────────────────────────────────────────────

  async listRepos(): Promise<Repository[]> {
    return this.request<Repository[]>('/api/repos');
  }

  async registerRepo(opts: { path: string; name?: string }): Promise<string> {
    const data = await this.request<{ id: string }>('/api/repos', {
      method: 'POST',
      body: JSON.stringify({ path: opts.path, name: opts.name ?? opts.path }),
    });
    return data.id;
  }

  async deleteRepo(id: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/repos/${id}`, { method: 'DELETE' });
  }

  async indexRepo(id: string): Promise<string> {
    const data = await this.request<{ message: string }>(`/api/repos/${id}/index`, {
      method: 'POST',
    });
    return data.message;
  }

  async analyzeRepo(id: string): Promise<string> {
    const data = await this.request<{ message: string }>(`/api/repos/${id}/analyze`, {
      method: 'POST',
    });
    return data.message;
  }

  async ingestLocalEdges(
    namespace: string | undefined,
    edges: LocalEdgeIngestItem[],
  ): Promise<LocalEdgeIngestResponse> {
    return this.request<LocalEdgeIngestResponse>('/api/graph/ingest-local-edges', {
      method: 'POST',
      body: JSON.stringify({ namespace, edges }),
    });
  }

  async getRepo(id: string): Promise<Repository> {
    return this.request<Repository>(`/api/repos/${id}`);
  }
}
