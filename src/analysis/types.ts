// ── Analysis Types ─────────────────────────────────────────────────────────

export type EdgeType =
  | 'IMPORTS' | 'CALLS' | 'CONTAINS' | 'INHERITS' | 'IMPLEMENTS'
  | 'READS' | 'WRITES' | 'CO_CHANGED' | 'MODIFIED_BY'
  | 'HTTP_CALLS' | 'TESTS';

export type NodeKind =
  | 'file' | 'module' | 'class' | 'function' | 'method'
  | 'interface' | 'type' | 'constant' | 'endpoint' | 'test';

export interface SymbolNode {
  id: string;
  kind: NodeKind;
  label: string;
  file: string;
  line: number;
  endLine?: number;
  namespace?: string;
}

export interface EdgeFact {
  relationship: EdgeType;
  from: string;
  to: string;
  file: string;
  line: number;
  confidence: number;
  weight?: number;
}

export interface AnalysisResult {
  nodes: SymbolNode[];
  edges: EdgeFact[];
  filesAnalyzed: number;
  filesSkipped: number;
  parseErrors: string[];
  duration: number;
}

export interface QualityReport {
  totalFiles: number;
  analyzedFiles: number;
  skippedFiles: number;
  totalNodes: number;
  totalEdges: number;
  edgesByType: Record<string, number>;
  nodesByKind: Record<string, number>;
  parseErrors: string[];
  confidenceDistribution: { high: number; medium: number; low: number };
  duration: number;
  incremental: boolean;
  changedFiles: number;
}

export interface FileStamp {
  mtimeMs: number;
  size: number;
  hash?: string;
}

export interface AnalysisCache {
  files: Record<string, FileStamp>;
  version: number;
  edgeHash?: string;
}

export interface UploadChunk {
  id: string;
  edges: EdgeFact[];
  status: 'pending' | 'uploading' | 'done' | 'failed';
  retries: number;
  error?: string;
}

export const SCHEMA_VERSION = 2;
