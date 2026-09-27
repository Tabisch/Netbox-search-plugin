import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";

export default [
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.webextensions, ...globals.node },
    },
    plugins: { "@stylistic": stylistic },
    rules: {
      // Always use braces for if/else/for/while/do bodies…
      curly: ["error", "all"],
      // …and put the contents of every block on their own lines.
      "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: false }],
      "@stylistic/indent": ["error", 2, { SwitchCase: 1 }],
    },
  },
];
