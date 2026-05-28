// Remove the unused `var net2 = require("net")` from the bundled tunnel.js
// wrapper — it is present in the tunnel npm package source but never
// referenced, and code-quality scanners flag it as an unused variable.
const fs = require('fs');
const f = 'dist/index.js';
const before = fs.readFileSync(f, 'utf8');
const after = before.replace('    var net2 = require("net");\n', '');
if (before === after) {
  process.stderr.write('postbuild: warning: net2 line not found in dist/index.js\n');
} else {
  fs.writeFileSync(f, after);
}
