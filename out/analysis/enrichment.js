"use strict";
// ── Enrichment: Complexity, Test Mapping, API Surface, Code Smells ──────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeComplexity = analyzeComplexity;
exports.detectSmells = detectSmells;
exports.mapTestFiles = mapTestFiles;
exports.extractApiSurface = extractApiSurface;
// ── Complexity Analysis ─────────────────────────────────────────────────────
function analyzeComplexity(relPath, content) {
    const lines = content.split('\n');
    let maxNesting = 0;
    let currentNesting = 0;
    let cyclomaticProxy = 1;
    let functions = 0;
    let classes = 0;
    const branchKeywords = /\b(if|else if|elif|for|while|catch|case|&&|\|\||switch|match)\b/g;
    for (const line of lines) {
        // Cyclomatic complexity proxy: count branch keywords
        const branches = [...line.matchAll(branchKeywords)];
        cyclomaticProxy += branches.length;
        // Nesting by braces/indentation
        for (const ch of line) {
            if (ch === '{') {
                currentNesting++;
                maxNesting = Math.max(maxNesting, currentNesting);
            }
            if (ch === '}') {
                currentNesting = Math.max(0, currentNesting - 1);
            }
        }
        // Count functions/classes
        if (/\b(function|def|fn|func|sub)\b/.test(line)) {
            functions++;
        }
        if (/\b(class|struct|impl)\b/.test(line)) {
            classes++;
        }
    }
    const isHotspot = lines.length > 500 || cyclomaticProxy > 50 || maxNesting > 8;
    return { file: relPath, lines: lines.length, functions, classes, maxNesting, cyclomaticProxy, isHotspot };
}
// ── Code Smell Detection ────────────────────────────────────────────────────
function detectSmells(relPath, content, nodes) {
    const smells = [];
    const lines = content.split('\n');
    // God file: too many symbols
    const fileNodes = nodes.filter(n => n.file === relPath && n.kind !== 'file');
    if (fileNodes.length > 30) {
        smells.push({ file: relPath, kind: 'god-file', severity: 'warning', description: `File has ${fileNodes.length} symbols — consider splitting.` });
    }
    // Large class: too many methods
    const classMethods = new Map();
    for (const n of nodes) {
        if (n.kind === 'method' && n.file === relPath) {
            const cls = n.label.split('.')[0];
            classMethods.set(cls, (classMethods.get(cls) ?? 0) + 1);
        }
    }
    for (const [cls, count] of classMethods) {
        if (count > 15) {
            smells.push({ file: relPath, kind: 'large-class', severity: 'warning', description: `Class '${cls}' has ${count} methods.` });
        }
    }
    // Long methods: detect function bodies > 80 lines
    let fnStart = null;
    let fnName = '';
    let depth = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\b(function|def|fn|func|async\s+function|async\s+def)\s+(\w+)/.test(line)) {
            fnStart = i;
            fnName = (line.match(/\b(?:function|def|fn|func|async\s+function|async\s+def)\s+(\w+)/) ?? [])[1] ?? '';
            depth = 0;
        }
        for (const ch of line) {
            if (ch === '{') {
                depth++;
            }
            if (ch === '}') {
                depth--;
                if (depth <= 0 && fnStart !== null) {
                    const length = i - fnStart;
                    if (length > 80) {
                        smells.push({ file: relPath, kind: 'long-method', severity: 'warning', description: `Function '${fnName}' is ${length} lines.`, line: fnStart + 1 });
                    }
                    fnStart = null;
                }
            }
        }
    }
    // High complexity file
    if (lines.length > 1000) {
        smells.push({ file: relPath, kind: 'high-complexity', severity: 'critical', description: `File has ${lines.length} lines.` });
    }
    // Deep nesting
    let maxNest = 0;
    let nest = 0;
    for (const line of lines) {
        for (const ch of line) {
            if (ch === '{') {
                nest++;
                maxNest = Math.max(maxNest, nest);
            }
            if (ch === '}') {
                nest = Math.max(0, nest - 1);
            }
        }
    }
    if (maxNest > 6) {
        smells.push({ file: relPath, kind: 'deep-nesting', severity: 'info', description: `Max nesting depth: ${maxNest}` });
    }
    return smells;
}
// ── Test Mapping ────────────────────────────────────────────────────────────
function mapTestFiles(allFiles) {
    const edges = [];
    const sourceFiles = new Set(allFiles.filter(f => !isTestFile(f)));
    for (const testFile of allFiles.filter(isTestFile)) {
        const srcCandidate = guessSourceForTest(testFile);
        if (srcCandidate && sourceFiles.has(srcCandidate)) {
            edges.push({
                relationship: 'TESTS',
                from: `file:${testFile}`,
                to: `file:${srcCandidate}`,
                file: testFile,
                line: 1,
                confidence: 0.75
            });
        }
    }
    return edges;
}
function isTestFile(f) {
    return /\.(test|spec|_test|_spec)\.\w+$/.test(f)
        || /tests?[\\/]/.test(f)
        || /__tests__[\\/]/.test(f)
        || f.startsWith('test_')
        || f.includes('/test_');
}
function guessSourceForTest(testFile) {
    // Remove test indicators
    let src = testFile
        .replace(/\.(test|spec|_test|_spec)\./, '.')
        .replace(/tests?[\\/]/, 'src/')
        .replace(/__tests__[\\/]/, '');
    // Try common patterns
    if (src !== testFile) {
        return src;
    }
    return undefined;
}
// ── API Surface Mapping ─────────────────────────────────────────────────────
function extractApiSurface(relPath, content, namespace) {
    const nodes = [];
    const edges = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const n = i + 1;
        // Express/Fastify/Koa routes
        const routeMatch = line.match(/(?:app|router|server)\s*\.\s*(get|post|put|delete|patch|options|head|all)\s*\(\s*['"`]([^'"`]+)['"`]/i);
        if (routeMatch) {
            const method = routeMatch[1].toUpperCase();
            const path = routeMatch[2];
            const id = `endpoint:${method}:${path}`;
            nodes.push({ id, kind: 'endpoint', label: `${method} ${path}`, file: relPath, line: n, namespace });
            edges.push({ relationship: 'CONTAINS', from: `file:${relPath}`, to: id, file: relPath, line: n, confidence: 0.9 });
        }
        // Django urlpatterns
        const djangoMatch = line.match(/path\s*\(\s*['"]([^'"]+)['"].*?(\w+)\s*[,)]/);
        if (djangoMatch) {
            const path = djangoMatch[1];
            const handler = djangoMatch[2];
            const id = `endpoint:ALL:${path}`;
            nodes.push({ id, kind: 'endpoint', label: `${path} → ${handler}`, file: relPath, line: n, namespace });
            edges.push({ relationship: 'CONTAINS', from: `file:${relPath}`, to: id, file: relPath, line: n, confidence: 0.85 });
        }
        // Axum / actix-web routes
        const axumMatch = line.match(/\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"].*?(\w+)\s*\)/);
        if (axumMatch) {
            const method = axumMatch[1].toUpperCase();
            const path = axumMatch[2];
            const id = `endpoint:${method}:${path}`;
            nodes.push({ id, kind: 'endpoint', label: `${method} ${path}`, file: relPath, line: n, namespace });
            edges.push({ relationship: 'CONTAINS', from: `file:${relPath}`, to: id, file: relPath, line: n, confidence: 0.85 });
        }
    }
    return { nodes, edges };
}
//# sourceMappingURL=enrichment.js.map