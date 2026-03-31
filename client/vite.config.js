import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  publicDir: path.resolve(__dirname, "../assets"),
  server: {
    proxy: {
      "/create": "http://localhost:2567",
      "/find-or-create": "http://localhost:2567",
    },
  },
});
