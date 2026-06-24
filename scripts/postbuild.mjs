// Remove the unused `var net2 = require("net")` from the bundled tunnel.js
// wrapper — it is present in the tunnel npm package source but never
// referenced, and code-quality scanners flag it as an unused variable.
import fs from 'fs';
const f = 'dist/index.js';
const before = fs.readFileSync(f, 'utf8');
// Match either quote style and any leading indentation; no-op if not present.
const after = before.replace(/^[ \t]*var net2 = require\(["']net["']\);\n/m, '');
if (before !== after) {
  fs.writeFileSync(f, after);
}
