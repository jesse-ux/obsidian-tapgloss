import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import json from "@rollup/plugin-json";
import terser from "@rollup/plugin-terser";

export default {
  input: "src/main.ts",
  output: {
    dir: ".",
    format: "cjs",
    sourcemap: true,
    exports: "default"
  },
  external: ["obsidian", "electron", "codemirror", "@codemirror/view", "@codemirror/state"],
  plugins: [
    nodeResolve({ browser: true }),
    commonjs(),
    json(),
    typescript({ tsconfig: "tsconfig.json" }),
    terser()
  ]
};
