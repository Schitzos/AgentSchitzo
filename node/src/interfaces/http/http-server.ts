import http from "http";
import express from "express";
import cors from "cors";
import { apiRouter } from "./api-router.ts";
import { initWss } from "../../server/ws-emitter.ts";

const PORT = parseInt(process.env.API_PORT ?? "3001");

export function createApiServer(): http.Server {
  const app = express();
  app.use(cors({ origin: "*" }));
  app.use(express.json());
  app.use("/api", apiRouter);
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  const server = http.createServer(app);
  initWss(server);
  return server;
}

export function startApiServer(): void {
  const server = createApiServer();
  server.listen(PORT, () => {
    console.log(`[API] Server running on http://localhost:${PORT}`);
  });
}
