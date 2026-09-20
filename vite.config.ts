import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "public",
  publicDir: "static",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        hub: resolve(import.meta.dirname, "public/index.html"),
        compass: resolve(import.meta.dirname, "public/compass/index.html"),
        oauth: resolve(import.meta.dirname, "public/oauth/index.html"),
        oauthPrivacy: resolve(import.meta.dirname, "public/oauth/privacy/index.html"),
        oauthTerms: resolve(import.meta.dirname, "public/oauth/terms/index.html"),
      },
    },
  },
});
