"use strict";
// ── Utility helpers for analysis modules ────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.execAsync = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
exports.execAsync = (0, util_1.promisify)(child_process_1.exec);
//# sourceMappingURL=util.js.map