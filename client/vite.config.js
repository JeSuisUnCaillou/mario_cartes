import { defineConfig } from "vite";
import path from "path";

function homePagePlugin() {
  return {
    name: "home-page",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/") {
          req.url = "/home.html";
        }
        next();
      });
    },
  };
}

export default defineConfig({
  publicDir: path.resolve(__dirname, "../assets"),
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        home: path.resolve(__dirname, "home.html"),
      },
    },
  },
  plugins: [homePagePlugin()],
  server: {
    proxy: {
      "/create": "http://localhost:2567",
      "/find-or-create": "http://localhost:2567",
    },
  },
});
