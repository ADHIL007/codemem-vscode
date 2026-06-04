"use strict";
// ── AST-based Parser for TS/JS, Python, Rust ──────────────────────────────
// Uses regex-based heuristics that approximate AST parsing without external deps.
// Structured to produce stable symbol IDs and high-confidence edges.
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTsJs = parseTsJs;
exports.parsePython = parsePython;
exports.parseRust = parseRust;
exports.parseGeneric = parseGeneric;
exports.parseFile = parseFile;
// ── Stable ID generation ────────────────────────────────────────────────────
function fileId(relPath) {
    return `file:${relPath}`;
}
function symbolId(relPath, kind, name) {
    return `sym:${relPath}#${kind}:${name}`;
}
function moduleId(name) {
    return `module:${name}`;
}
// ── TypeScript / JavaScript Parser ──────────────────────────────────────────
function parseTsJs(relPath, content, namespace) {
    const nodes = [];
    const edges = [];
    const errors = [];
    const lines = content.split('\n');
    const fid = fileId(relPath);
    nodes.push({ id: fid, kind: 'file', label: relPath, file: relPath, line: 1, namespace });
    let currentClass;
    let currentFunction;
    let braceDepth = 0;
    let classDepth = -1;
    let fnDepth = -1;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const n = i + 1;
        // Track brace depth for scope
        for (const ch of line) {
            if (ch === '{') {
                braceDepth++;
            }
            if (ch === '}') {
                braceDepth--;
                if (braceDepth <= classDepth) {
                    currentClass = undefined;
                    classDepth = -1;
                }
                if (braceDepth <= fnDepth) {
                    currentFunction = undefined;
                    fnDepth = -1;
                }
            }
        }
        // ── Imports ──────────────────────────────────────────────────────────
        const importFrom = line.match(/\bimport\s+(?:(?:\{[^}]*\}|[^'"]+)\s+from\s+)?['\"]([^'"]+)['"]/);
        if (importFrom) {
            edges.push({ relationship: 'IMPORTS', from: fid, to: moduleId(importFrom[1]), file: relPath, line: n, confidence: 0.95 });
            continue;
        }
        const requireCall = line.match(/\brequire\(\s*['\"]([^'"]+)['"]\s*\)/);
        if (requireCall) {
            edges.push({ relationship: 'IMPORTS', from: fid, to: moduleId(requireCall[1]), file: relPath, line: n, confidence: 0.95 });
        }
        // ── Exports (re-exports) ─────────────────────────────────────────────
        const exportFrom = line.match(/\bexport\s+.*\bfrom\s+['\"]([^'"]+)['"]/);
        if (exportFrom) {
            edges.push({ relationship: 'IMPORTS', from: fid, to: moduleId(exportFrom[1]), file: relPath, line: n, confidence: 0.9 });
        }
        // ── Classes ──────────────────────────────────────────────────────────
        const classMatch = line.match(/^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]*>)?\s*(?:extends\s+([A-Za-z_$][A-Za-z0-9_$.]*))?\s*(?:implements\s+([^{]+))?/);
        if (classMatch) {
            const className = classMatch[1];
            const sid = symbolId(relPath, 'class', className);
            nodes.push({ id: sid, kind: 'class', label: className, file: relPath, line: n, namespace });
            edges.push({ relationship: 'CONTAINS', from: fid, to: sid, file: relPath, line: n, confidence: 1.0 });
            currentClass = className;
            classDepth = braceDepth;
            if (classMatch[2]) {
                edges.push({ relationship: 'INHERITS', from: sid, to: `sym:${classMatch[2]}`, file: relPath, line: n, confidence: 0.9 });
            }
            if (classMatch[3]) {
                const ifaces = classMatch[3].split(',').map(s => s.trim()).filter(Boolean);
                for (const iface of ifaces) {
                    const ifaceName = iface.replace(/<.*>/, '').trim();
                    edges.push({ relationship: 'IMPLEMENTS', from: sid, to: `sym:${ifaceName}`, file: relPath, line: n, confidence: 0.9 });
                }
            }
            continue;
        }
        // ── Interfaces ───────────────────────────────────────────────────────
        const ifaceMatch = line.match(/^\s*(?:export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]*>)?\s*(?:extends\s+([^{]+))?/);
        if (ifaceMatch) {
            const ifaceName = ifaceMatch[1];
            const sid = symbolId(relPath, 'interface', ifaceName);
            nodes.push({ id: sid, kind: 'interface', label: ifaceName, file: relPath, line: n, namespace });
            edges.push({ relationship: 'CONTAINS', from: fid, to: sid, file: relPath, line: n, confidence: 1.0 });
            if (ifaceMatch[2]) {
                const parents = ifaceMatch[2].split(',').map(s => s.trim().replace(/<.*>/, '')).filter(Boolean);
                for (const p of parents) {
                    edges.push({ relationship: 'INHERITS', from: sid, to: `sym:${p}`, file: relPath, line: n, confidence: 0.85 });
                }
            }
            continue;
        }
        // ── Type aliases ─────────────────────────────────────────────────────
        const typeMatch = line.match(/^\s*(?:export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]*>)?\s*=/);
        if (typeMatch) {
            const typeName = typeMatch[1];
            const sid = symbolId(relPath, 'type', typeName);
            nodes.push({ id: sid, kind: 'type', label: typeName, file: relPath, line: n, namespace });
            edges.push({ relationship: 'CONTAINS', from: fid, to: sid, file: relPath, line: n, confidence: 1.0 });
            continue;
        }
        // ── Functions / Methods ──────────────────────────────────────────────
        const fnMatch = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[(<]/);
        if (fnMatch) {
            const fnName = fnMatch[1];
            const kind = fnName.startsWith('test') || fnName.startsWith('it') || fnName.startsWith('describe') ? 'test' : 'function';
            const sid = symbolId(relPath, kind, fnName);
            nodes.push({ id: sid, kind, label: fnName, file: relPath, line: n, namespace });
            edges.push({ relationship: 'CONTAINS', from: fid, to: sid, file: relPath, line: n, confidence: 1.0 });
            currentFunction = fnName;
            fnDepth = braceDepth;
            continue;
        }
        // Method inside class
        if (currentClass) {
            const methodMatch = line.match(/^\s*(?:public|private|protected|static|async|get|set|\s)*\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[(<]/);
            if (methodMatch && !['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'typeof'].includes(methodMatch[1])) {
                const methodName = methodMatch[1];
                const kind = methodName.startsWith('test') ? 'test' : 'method';
                const sid = symbolId(relPath, kind, `${currentClass}.${methodName}`);
                nodes.push({ id: sid, kind, label: `${currentClass}.${methodName}`, file: relPath, line: n, namespace });
                edges.push({ relationship: 'CONTAINS', from: symbolId(relPath, 'class', currentClass), to: sid, file: relPath, line: n, confidence: 1.0 });
                currentFunction = `${currentClass}.${methodName}`;
                fnDepth = braceDepth;
            }
        }
        // ── Arrow functions / const declarations ─────────────────────────────
        const constFn = line.match(/^\s*(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?\(?/);
        if (constFn && (line.includes('=>') || line.includes('function'))) {
            const fnName = constFn[1];
            const sid = symbolId(relPath, 'function', fnName);
            nodes.push({ id: sid, kind: 'function', label: fnName, file: relPath, line: n, namespace });
            edges.push({ relationship: 'CONTAINS', from: fid, to: sid, file: relPath, line: n, confidence: 0.85 });
        }
        // ── Constants ────────────────────────────────────────────────────────
        const constMatch = line.match(/^\s*(?:export\s+)?const\s+([A-Z_][A-Z0-9_]*)\s*=/);
        if (constMatch && !line.includes('=>') && !line.includes('function')) {
            const cName = constMatch[1];
            const sid = symbolId(relPath, 'constant', cName);
            nodes.push({ id: sid, kind: 'constant', label: cName, file: relPath, line: n, namespace });
            edges.push({ relationship: 'CONTAINS', from: fid, to: sid, file: relPath, line: n, confidence: 0.8 });
        }
        // ── Function calls ───────────────────────────────────────────────────
        const caller = currentFunction
            ? symbolId(relPath, currentClass ? 'method' : 'function', currentFunction)
            : fid;
        const callMatches = [...line.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)];
        const stopwords = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'typeof', 'import', 'require', 'export', 'class', 'function', 'interface', 'type', 'const', 'let', 'var', 'await', 'async', 'super', 'this', 'console', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise', 'JSON', 'Error', 'Map', 'Set', 'Date', 'RegExp', 'parseInt', 'parseFloat', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval']);
        for (const m of callMatches) {
            const callee = m[1];
            if (!stopwords.has(callee) && callee.length > 1) {
                edges.push({ relationship: 'CALLS', from: caller, to: `sym:${callee}`, file: relPath, line: n, confidence: 0.6 });
            }
        }
        // ── Property reads/writes ────────────────────────────────────────────
        const propRead = line.match(/(?:this|self)\.([A-Za-z_$][A-Za-z0-9_$]*)\b(?!\s*[=(])/);
        if (propRead && currentClass) {
            edges.push({ relationship: 'READS', from: caller, to: symbolId(relPath, 'class', `${currentClass}.${propRead[1]}`), file: relPath, line: n, confidence: 0.5 });
        }
        const propWrite = line.match(/(?:this|self)\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=/);
        if (propWrite && currentClass) {
            edges.push({ relationship: 'WRITES', from: caller, to: symbolId(relPath, 'class', `${currentClass}.${propWrite[1]}`), file: relPath, line: n, confidence: 0.5 });
        }
        // ── Route / endpoint detection ───────────────────────────────────────
        const routeMatch = line.match(/\.(get|post|put|delete|patch)\s*\(\s*['\"]([^'"]+)['"]/i);
        if (routeMatch) {
            const method = routeMatch[1].toUpperCase();
            const route = routeMatch[2];
            const epId = symbolId(relPath, 'endpoint', `${method}:${route}`);
            nodes.push({ id: epId, kind: 'endpoint', label: `${method} ${route}`, file: relPath, line: n, namespace });
            edges.push({ relationship: 'CONTAINS', from: fid, to: epId, file: relPath, line: n, confidence: 0.85 });
        }
        // ── HTTP client call detection ───────────────────────────────────────
        const httpCall = line.match(/(?:fetch|axios|http|client)\s*(?:\.)?\s*(?:get|post|put|delete|patch)?\s*\(\s*[`'"]([^`'"]*)[`'"]/i);
        if (httpCall) {
            const url = httpCall[1];
            edges.push({ relationship: 'HTTP_CALLS', from: caller, to: `endpoint:${url}`, file: relPath, line: n, confidence: 0.7 });
        }
    }
    return { nodes, edges, errors };
}
// ── Python Parser ───────────────────────────────────────────────────────────
function parsePython(relPath, content, namespace) {
    const nodes = [];
    const edges = [];
    const errors = [];
    const lines = content.split('\n');
    const fid = fileId(relPath);
    nodes.push({ id: fid, kind: 'file', label: relPath, file: relPath, line: 1, namespace });
    let currentClass;
    let currentFunction;
    const indentStack = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const n = i + 1;
        const indent = line.search(/\S/);
        if (indent < 0) {
            continue;
        }
        // Pop scope
        while (indentStack.length > 0 && indent <= indentStack[indentStack.length - 1].indent) {
            const popped = indentStack.pop();
            if (popped.kind === 'class') {
                currentClass = undefined;
            }
            if (popped.kind === 'function') {
                currentFunction = undefined;
            }
        }
        // ── Imports ──────────────────────────────────────────────────────────
        const importMatch = line.match(/^\s*import\s+([a-zA-Z0-9_.]+)/);
        if (importMatch) {
            edges.push({ relationship: 'IMPORTS', from: fid, to: moduleId(importMatch[1]), file: relPath, line: n, confidence: 0.95 });
            continue;
        }
        const fromImport = line.match(/^\s*from\s+([a-zA-Z0-9_.]+)\s+import/);
        if (fromImport) {
            edges.push({ relationship: 'IMPORTS', from: fid, to: moduleId(fromImport[1]), file: relPath, line: n, confidence: 0.95 });
            continue;
        }
        // ── Classes ──────────────────────────────────────────────────────────
        const classMatch = line.match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\(([^)]*)\))?/);
        if (classMatch) {
            const className = classMatch[1];
            const sid = symbolId(relPath, 'class', className);
            nodes.push({ id: sid, kind: 'class', label: className, file: relPath, line: n, namespace });
            edges.push({ relationship: 'CONTAINS', from: fid, to: sid, file: relPath, line: n, confidence: 1.0 });
            currentClass = className;
            indentStack.push({ name: className, indent, kind: 'class' });
            if (classMatch[2]) {
                const bases = classMatch[2].split(',').map(s => s.trim()).filter(Boolean);
                for (const base of bases) {
                    const baseName = base.replace(/\(.*/, '').trim();
                    if (baseName && baseName !== 'object') {
                        edges.push({ relationship: 'INHERITS', from: sid, to: `sym:${baseName}`, file: relPath, line: n, confidence: 0.9 });
                    }
                }
            }
            continue;
        }
        // ── Functions / Methods ──────────────────────────────────────────────
        const fnMatch = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
        if (fnMatch) {
            const fnName = fnMatch[1];
            const isTest = fnName.startsWith('test_') || fnName.startsWith('test');
            const isMethod = currentClass !== undefined;
            const kind = isTest ? 'test' : isMethod ? 'method' : 'function';
            const label = isMethod ? `${currentClass}.${fnName}` : fnName;
            const sid = symbolId(relPath, kind, label);
            nodes.push({ id: sid, kind, label, file: relPath, line: n, namespace });
            const parent = currentClass ? symbolId(relPath, 'class', currentClass) : fid;
            edges.push({ relationship: 'CONTAINS', from: parent, to: sid, file: relPath, line: n, confidence: 1.0 });
            currentFunction = label;
            indentStack.push({ name: label, indent, kind: 'function' });
            // Test links
            if (isTest) {
                const tested = fnName.replace(/^test_?/, '');
                if (tested) {
                    edges.push({ relationship: 'TESTS', from: sid, to: `sym:${tested}`, file: relPath, line: n, confidence: 0.6 });
                }
            }
            continue;
        }
        // ── Decorator detection ──────────────────────────────────────────────
        const decoratorRoute = line.match(/@(?:app|router|blueprint)\.(get|post|put|delete|patch)\s*\(\s*['\"]([^'"]+)['"]/i);
        if (decoratorRoute) {
            const method = decoratorRoute[1].toUpperCase();
            const route = decoratorRoute[2];
            const epId = symbolId(relPath, 'endpoint', `${method}:${route}`);
            nodes.push({ id: epId, kind: 'endpoint', label: `${method} ${route}`, file: relPath, line: n, namespace });
            edges.push({ relationship: 'CONTAINS', from: fid, to: epId, file: relPath, line: n, confidence: 0.9 });
        }
        // ── Function calls ───────────────────────────────────────────────────
        const caller = currentFunction
            ? symbolId(relPath, currentClass ? 'method' : 'function', currentFunction)
            : fid;
        const pyStopwords = new Set(['if', 'for', 'while', 'with', 'return', 'yield', 'raise', 'del', 'print', 'assert', 'pass', 'break', 'continue', 'lambda', 'not', 'and', 'or', 'in', 'is', 'True', 'False', 'None', 'self', 'cls', 'super', 'type', 'len', 'range', 'list', 'dict', 'set', 'str', 'int', 'float', 'bool', 'tuple', 'isinstance', 'hasattr', 'getattr', 'setattr']);
        const callMatches = [...line.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)];
        for (const m of callMatches) {
            const callee = m[1];
            if (!pyStopwords.has(callee) && callee.length > 1 && !/^[a-z]$/.test(callee)) {
                edges.push({ relationship: 'CALLS', from: caller, to: `sym:${callee}`, file: relPath, line: n, confidence: 0.55 });
            }
        }
    }
    return { nodes, edges, errors };
}
// ── Rust Parser ─────────────────────────────────────────────────────────────
function parseRust(relPath, content, namespace) {
    const nodes = [];
    const edges = [];
    const errors = [];
    const lines = content.split('\n');
    const fid = fileId(relPath);
    nodes.push({ id: fid, kind: 'file', label: relPath, file: relPath, line: 1, namespace });
    let currentImpl;
    let currentFn;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const n = i + 1;
        // ── Use statements ───────────────────────────────────────────────────
        const useMatch = line.match(/^\s*use\s+([^;{]+)/);
        if (useMatch) {
            const mod = useMatch[1].trim().replace(/\s*\{.*/, '');
            edges.push({ relationship: 'IMPORTS', from: fid, to: moduleId(mod), file: relPath, line: n, confidence: 0.95 });
            continue;
        }
        // ── Structs ──────────────────────────────────────────────────────────
        const structMatch = line.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (structMatch) {
            const name = structMatch[1];
            const sid = symbolId(relPath, 'class', name);
            nodes.push({ id: sid, kind: 'class', label: name, file: relPath, line: n, namespace });
            edges.push({ relationship: 'CONTAINS', from: fid, to: sid, file: relPath, line: n, confidence: 1.0 });
            continue;
        }
        // ── Enums ────────────────────────────────────────────────────────────
        const enumMatch = line.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (enumMatch) {
            const name = enumMatch[1];
            const sid = symbolId(relPath, 'type', name);
            nodes.push({ id: sid, kind: 'type', label: name, file: relPath, line: n, namespace });
            edges.push({ relationship: 'CONTAINS', from: fid, to: sid, file: relPath, line: n, confidence: 1.0 });
            continue;
        }
        // ── Traits ───────────────────────────────────────────────────────────
        const traitMatch = line.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (traitMatch) {
            const name = traitMatch[1];
            const sid = symbolId(relPath, 'interface', name);
            nodes.push({ id: sid, kind: 'interface', label: name, file: relPath, line: n, namespace });
            edges.push({ relationship: 'CONTAINS', from: fid, to: sid, file: relPath, line: n, confidence: 1.0 });
            continue;
        }
        // ── Impl blocks ──────────────────────────────────────────────────────
        const implMatch = line.match(/^\s*impl(?:<[^>]*>)?\s+(?:([A-Za-z_][A-Za-z0-9_:]*)\s+for\s+)?([A-Za-z_][A-Za-z0-9_]*)/);
        if (implMatch) {
            currentImpl = implMatch[2];
            if (implMatch[1]) {
                const traitName = implMatch[1].split('::').pop() ?? implMatch[1];
                const sid = symbolId(relPath, 'class', currentImpl);
                edges.push({ relationship: 'IMPLEMENTS', from: sid, to: `sym:${traitName}`, file: relPath, line: n, confidence: 0.9 });
            }
            continue;
        }
        // ── Functions ────────────────────────────────────────────────────────
        const fnMatch = line.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (fnMatch) {
            const fnName = fnMatch[1];
            const isTest = line.includes('#[test]') || (i > 0 && lines[i - 1].includes('#[test]'));
            const label = currentImpl ? `${currentImpl}::${fnName}` : fnName;
            const kind = isTest ? 'test' : currentImpl ? 'method' : 'function';
            const sid = symbolId(relPath, kind, label);
            nodes.push({ id: sid, kind, label, file: relPath, line: n, namespace });
            const parent = currentImpl ? symbolId(relPath, 'class', currentImpl) : fid;
            edges.push({ relationship: 'CONTAINS', from: parent, to: sid, file: relPath, line: n, confidence: 1.0 });
            currentFn = label;
            if (isTest) {
                const tested = fnName.replace(/^test_?/, '');
                if (tested) {
                    edges.push({ relationship: 'TESTS', from: sid, to: `sym:${tested}`, file: relPath, line: n, confidence: 0.6 });
                }
            }
            continue;
        }
        // ── Function calls ───────────────────────────────────────────────────
        const caller = currentFn
            ? symbolId(relPath, currentImpl ? 'method' : 'function', currentFn)
            : fid;
        const rustStopwords = new Set(['if', 'for', 'while', 'match', 'loop', 'return', 'let', 'mut', 'pub', 'fn', 'impl', 'struct', 'enum', 'trait', 'use', 'mod', 'self', 'super', 'crate', 'Some', 'None', 'Ok', 'Err', 'vec', 'println', 'eprintln', 'format', 'write', 'writeln', 'panic', 'assert', 'assert_eq', 'assert_ne', 'debug_assert', 'todo', 'unimplemented', 'unreachable', 'cfg', 'derive', 'include']);
        const callMatches = [...line.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*[!(]\s*/g)];
        for (const m of callMatches) {
            const callee = m[1];
            if (!rustStopwords.has(callee) && callee.length > 1 && callee[0] === callee[0].toLowerCase()) {
                edges.push({ relationship: 'CALLS', from: caller, to: `sym:${callee}`, file: relPath, line: n, confidence: 0.5 });
            }
        }
    }
    return { nodes, edges, errors };
}
// ── Generic Fallback Parser ─────────────────────────────────────────────────
function parseGeneric(relPath, content, namespace) {
    const nodes = [];
    const edges = [];
    const fid = fileId(relPath);
    nodes.push({ id: fid, kind: 'file', label: relPath, file: relPath, line: 1, namespace });
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const n = i + 1;
        // Basic import detection
        const importMatch = line.match(/(?:import|require|include|#include)\s*[<"']([^>"']+)[>"']/);
        if (importMatch) {
            edges.push({ relationship: 'IMPORTS', from: fid, to: moduleId(importMatch[1]), file: relPath, line: n, confidence: 0.7 });
        }
        // Basic function detection
        const fnMatch = line.match(/(?:function|func|def|fn|sub|proc)\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (fnMatch) {
            const sid = symbolId(relPath, 'function', fnMatch[1]);
            nodes.push({ id: sid, kind: 'function', label: fnMatch[1], file: relPath, line: n, namespace });
            edges.push({ relationship: 'CONTAINS', from: fid, to: sid, file: relPath, line: n, confidence: 0.7 });
        }
        // Basic class detection
        const classMatch = line.match(/(?:class|struct|interface|trait)\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (classMatch) {
            const sid = symbolId(relPath, 'class', classMatch[1]);
            nodes.push({ id: sid, kind: 'class', label: classMatch[1], file: relPath, line: n, namespace });
            edges.push({ relationship: 'CONTAINS', from: fid, to: sid, file: relPath, line: n, confidence: 0.7 });
        }
    }
    return { nodes, edges, errors: [] };
}
// ── Router ──────────────────────────────────────────────────────────────────
function parseFile(relPath, content, namespace) {
    const ext = relPath.split('.').pop()?.toLowerCase() ?? '';
    switch (ext) {
        case 'ts':
        case 'tsx':
        case 'js':
        case 'jsx':
        case 'mjs':
        case 'cjs':
            return parseTsJs(relPath, content, namespace);
        case 'py':
        case 'pyw':
            return parsePython(relPath, content, namespace);
        case 'rs':
            return parseRust(relPath, content, namespace);
        default:
            return parseGeneric(relPath, content, namespace);
    }
}
//# sourceMappingURL=parser.js.map