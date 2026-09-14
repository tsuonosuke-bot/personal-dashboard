import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        hub: resolve(import.meta.dirname, "public/index.html"),
        compass: resolve(import.meta.dirname, "public/compass/index.html"),
      },
    },
  },
});
