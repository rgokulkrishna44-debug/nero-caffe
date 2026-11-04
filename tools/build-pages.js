// Copies public/ to docs/ for GitHub Pages (Settings > Pages > main branch, /docs folder).
// On github.io, public/api-shim.js sends every /api call to the NERO Caffe API workflow on n8n.
// Run: node tools/build-pages.js
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.join(root, "docs");

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, "public"), out, { recursive: true });
fs.writeFileSync(path.join(out, ".nojekyll"), "");
console.log("Built docs/ for GitHub Pages");
