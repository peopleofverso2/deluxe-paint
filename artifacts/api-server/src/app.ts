import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { sessionMiddleware } from "./middlewares/session";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Same-origin in production (Cloud Run serves both API + SPA). CORS is
// permissive in dev so vite preview / localhost can call the API.
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "20mb" }));   // .dpaint payloads with embedded PNGs can be large
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use(cookieParser());
app.use(sessionMiddleware);

app.use("/api", router);

// Serve the built SPA. In the Docker image the static files end up at
// /app/public; locally they're under the deluxe-paint workspace dist.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.resolve(__dirname, "../public"),                                  // packaged
  path.resolve(__dirname, "../../deluxe-paint/dist/public"),             // dev (workspace)
];
const publicDir = candidates.find(p => existsSync(path.join(p, "index.html")));
if (publicDir) {
  app.use(express.static(publicDir, { fallthrough: true, maxAge: "1h" }));
  // SPA fallback — any non-API GET that isn't a real file serves index.html
  // (so wouter client routes like /p/:id work on a hard reload).
  app.get(/^\/(?!api\/).*/, (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") return next();
    res.sendFile(path.join(publicDir, "index.html"));
  });
} else {
  logger.warn("No SPA public dir found — API-only mode");
}

export default app;
