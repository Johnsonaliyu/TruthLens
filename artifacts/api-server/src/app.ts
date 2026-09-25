import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { existsSync } from "node:fs";
import path from "node:path";
import router from "./routes";
import { logger } from "./lib/logger";

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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const frontendDist = path.resolve(
  process.cwd(),
  "artifacts/truthlens-naija/dist/public",
);
const frontendIndex = path.join(frontendDist, "index.html");

if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
}

app.use((req, res, next) => {
  if (
    req.method !== "GET" ||
    req.path.startsWith("/api") ||
    !existsSync(frontendIndex)
  ) {
    next();
    return;
  }

  res.sendFile(frontendIndex);
});

export default app;
