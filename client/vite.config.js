import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/create": "http://localhost:2567",
    },
  },
});
