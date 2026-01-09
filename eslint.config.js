import js from "@eslint/js";
import globals from "globals";

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.node,
                tauri: "readonly",
                monaco: "readonly"
            }
        },
        rules: {
            "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
            "no-undef": "warn"
        }
    },
    {
        ignores: [
            "**/dist/**",
            "**/node_modules/**",
            "**/target/**",
            "src-tauri/**",
            "ui/src/components/**",
            "ui/src/git/**"
        ]
    }
];
