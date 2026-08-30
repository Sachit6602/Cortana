import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The Hermes session token never reaches the browser. HTTP calls get it as a
// header (stamped in `proxyReq`); the WebSocket upgrade gets it as a query
// param, which is the only auth the /api/ws endpoint accepts — so we rewrite
// the path here rather than let the client hold the token.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.HERMES_API || "http://127.0.0.1:9500";
  const token = env.HERMES_TOKEN || "";

  type ProxyLike = {
    on: (e: string, cb: (r: { setHeader: (k: string, v: string) => void }) => void) => void;
  };

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5180,
      proxy: {
        // More specific first — Vite matches keys in order.
        "/api/ws": {
          target: target.replace(/^http/, "ws"),
          ws: true,
          changeOrigin: true,
          rewrite: (path) =>
            `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`,
        },
        "/api": {
          target,
          changeOrigin: true,
          configure: (proxy: ProxyLike) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (token) proxyReq.setHeader("X-Hermes-Session-Token", token);
            });
          },
        },
      },
    },
  };
});
