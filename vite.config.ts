import { defineConfig } from "vite";
import { resolve } from "node:path";

// 多页应用：练习页 index.html + 制谱编辑器 editor.html
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        editor: resolve(import.meta.dirname, "editor.html"),
        midi: resolve(import.meta.dirname, "midi.html"),
      },
    },
  },
});
