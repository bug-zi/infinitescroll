import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

type DevApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
type DevApiModule = {
  handleDevApiRequest: DevApiHandler;
  startLocalScheduler: () => void;
};

let devApiModulePromise: Promise<DevApiModule> | undefined;

function loadDevApiModule() {
  const moduleUrl = new URL("./scripts/dev-api.mjs", import.meta.url).href;
  devApiModulePromise ??= import(moduleUrl).then((mod) => mod as DevApiModule);
  return devApiModulePromise;
}

function localApiPlugin(): Plugin {
  return {
    name: "local-api",
    configureServer(server) {
      const startScheduler = () => {
        if (process.env.NODE_ENV === "test" || process.env.VITEST || process.env.DISABLE_LOCAL_AUTO_GENERATION === "true") return;
        loadDevApiModule()
          .then((devApi) => devApi.startLocalScheduler())
          .catch((error: unknown) => {
            server.config.logger.error(error instanceof Error ? error.stack ?? error.message : String(error));
          });
      };

      server.httpServer?.once("listening", startScheduler);
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api")) {
          next();
          return;
        }

        loadDevApiModule()
          .then((devApi) => devApi.handleDevApiRequest(req, res))
          .catch((error: unknown) => {
            server.config.logger.error(error instanceof Error ? error.stack ?? error.message : String(error));
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
            }
            res.end(JSON.stringify({ error: "Local API request failed" }));
          });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApiPlugin()],
  server: {
    port: 5173,
  },
});
