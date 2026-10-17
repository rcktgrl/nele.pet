import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { ignores: ["**/vendor/**"] },
  { files: ["**/*.{js,mjs,cjs}"], plugins: { js }, extends: ["js/recommended"], languageOptions: { globals: globals.browser } },
  // Red Mesa Rally loads its files as plain <script> tags that share one global scope,
  // so names declared in one file are used in the next.
  { files: ["games/red-mesa-rally/js/**/*.js"], languageOptions: { sourceType: "script", globals: { ...globals.browser, THREE: "readonly" } }, rules: { "no-undef": "off", "no-unused-vars": "off", "no-useless-assignment": "off" } },
  { files: ["**/test/**/*.{js,mjs,cjs}"], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
]);
