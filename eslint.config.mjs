import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";
import { readFileSync, readdirSync } from "node:fs";
import * as espree from "espree";

// Red Mesa Rally's files share one global scope: collect every name a file declares at its top level,
// so that a name used anywhere must exist somewhere (catches typos and leftovers of renamed things).
const RMR = "games/red-mesa-rally/js";
const rmrGlobals = { THREE: "readonly", RMR_VERSION: "readonly" };
for (const f of readdirSync(RMR, { recursive: true }).filter((f) => f.endsWith(".js"))) {
  const names = (p) => p.type === "Identifier" ? [p.name] : p.type === "ObjectPattern" ? p.properties.flatMap((q) => names(q.value || q.argument))
    : p.type === "ArrayPattern" ? p.elements.filter(Boolean).flatMap(names) : names(p.left || p.argument);
  for (const node of espree.parse(readFileSync(`${RMR}/${f}`, "utf8"), { ecmaVersion: "latest" }).body) {
    if (node.type === "VariableDeclaration") for (const d of node.declarations) for (const n of names(d.id)) rmrGlobals[n] = "writable";
    else if (node.id) rmrGlobals[node.id.name] = "writable";
  }
}

export default defineConfig([
  { ignores: ["**/vendor/**", "test/rmr/queries/**"] }, // queries are function bodies, not whole scripts
  { files: ["**/*.{js,mjs,cjs}"], plugins: { js }, extends: ["js/recommended"], languageOptions: { globals: globals.browser } },
  // Red Mesa Rally loads its files as plain <script> tags that share one global scope,
  // so names declared in one file are used in the next.
  { files: ["games/red-mesa-rally/js/**/*.js"], languageOptions: { sourceType: "script", globals: { ...globals.browser, ...rmrGlobals } }, rules: { "no-redeclare": ["error", { builtinGlobals: false }], "no-unused-vars": "off", "no-useless-assignment": "off" } },
  { files: ["**/test/**/*.{js,mjs,cjs}"], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
]);
