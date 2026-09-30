import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();
app.disable("x-powered-by");

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

const configuredOrigin = process.env.APP_ORIGIN;
app.use(
  cors({
    origin: configuredOrigin || false,
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    const message = error instanceof Error ? error.message : "Request failed.";
    const status = /valid|required|invalid/i.test(message) ? 400 : 500;
    if (status === 500) logger.error({ err: error }, "Unhandled request error");
    response
      .status(status)
      .json({ error: status === 500 ? "Request could not be completed." : message });
  },
);

export default app;
