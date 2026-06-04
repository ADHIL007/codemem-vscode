"use strict";
// ── Smart Memory Auto-creation from Graph Motifs ────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAutoMemories = generateAutoMemories;
/**
 * Generate automatic memories from analysis results.
 */
function generateAutoMemories(nodes, edges, smells, hotspots) {
    const memories = [];
    // ── High-centrality hub files ────────────────────────────────────────────
    const inDegree = new Map();
    const outDegree = new Map();
    for (const e of edges) {
        inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
        outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1);
    }
    // Top hub nodes by in-degree
    const hubs = [...inDegree.entries()]
        .filter(([id]) => id.startsWith('file:') || id.startsWith('sym:'))
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);
    for (const [id, degree] of hubs) {
        if (degree >= 10) {
            const label = id.replace(/^(file:|sym:|module:)/, '');
            memories.push({
                title: `Hub: ${label}`,
                body: `'${label}' is a high-centrality node (${degree} incoming edges). Changes here likely have wide impact.`,
                tags: ['architecture', 'hub', 'high-impact'],
                confidence: 0.8,
                kind: 'architecture'
            });
        }
    }
    // ── Critical code smells → warnings ──────────────────────────────────────
    const criticalSmells = smells.filter(s => s.severity === 'critical');
    for (const smell of criticalSmells.slice(0, 5)) {
        memories.push({
            title: `Warning: ${smell.kind} in ${smell.file}`,
            body: smell.description,
            tags: ['code-smell', smell.kind, 'refactoring-candidate'],
            confidence: 0.7,
            kind: 'warning'
        });
    }
    // ── Architectural patterns from inheritance/impl trees ───────────────────
    const inheritEdges = edges.filter(e => e.relationship === 'INHERITS' || e.relationship === 'IMPLEMENTS');
    const interfaceImpls = new Map();
    for (const e of inheritEdges) {
        const target = e.to.replace(/^sym:/, '');
        if (!interfaceImpls.has(target)) {
            interfaceImpls.set(target, []);
        }
        interfaceImpls.get(target).push(e.from.replace(/^sym:/, '').split('#').pop() ?? e.from);
    }
    for (const [iface, impls] of interfaceImpls) {
        if (impls.length >= 3) {
            memories.push({
                title: `Pattern: ${iface} hierarchy`,
                body: `Interface/trait '${iface}' has ${impls.length} implementations: ${impls.slice(0, 5).join(', ')}${impls.length > 5 ? '...' : ''}. This is a polymorphism pattern.`,
                tags: ['pattern', 'polymorphism', 'architecture'],
                confidence: 0.75,
                kind: 'pattern'
            });
        }
    }
    // ── Hotspot clusters ─────────────────────────────────────────────────────
    if (hotspots.length >= 3) {
        const topHotspots = hotspots.slice(0, 5);
        memories.push({
            title: `Hotspot cluster detected`,
            body: `${hotspots.length} complexity hotspots found. Top: ${topHotspots.map(h => `${h.file} (${h.cyclomaticProxy} cyclomatic)`).join(', ')}`,
            tags: ['hotspot', 'complexity', 'refactoring-candidate'],
            confidence: 0.7,
            kind: 'warning'
        });
    }
    // ── Co-change clusters → decision memories ──────────────────────────────
    const coChangeEdges = edges.filter(e => e.relationship === 'CO_CHANGED' && (e.weight ?? 0) > 0.5);
    if (coChangeEdges.length > 5) {
        const topPairs = coChangeEdges.slice(0, 5)
            .map(e => `${e.from.replace('file:', '')} ↔ ${e.to.replace('file:', '')}`)
            .join('; ');
        memories.push({
            title: `Co-change patterns detected`,
            body: `${coChangeEdges.length} strong co-change relationships. Top: ${topPairs}. Consider co-locating or documenting these dependencies.`,
            tags: ['co-change', 'coupling', 'architecture'],
            confidence: 0.65,
            kind: 'decision'
        });
    }
    // ── Endpoint summary ─────────────────────────────────────────────────────
    const endpoints = nodes.filter(n => n.kind === 'endpoint');
    if (endpoints.length > 0) {
        memories.push({
            title: `API Surface: ${endpoints.length} endpoints`,
            body: `Detected endpoints:\n${endpoints.slice(0, 15).map(e => `- ${e.label} (${e.file}:${e.line})`).join('\n')}${endpoints.length > 15 ? `\n...and ${endpoints.length - 15} more` : ''}`,
            tags: ['api', 'endpoints', 'architecture'],
            confidence: 0.85,
            kind: 'architecture'
        });
    }
    return memories;
}
//# sourceMappingURL=memories.js.map