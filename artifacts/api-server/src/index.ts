import app from "./app.js";
import { logger } from "./lib/logger.js";

const rawPort = process.env.PORT ?? "3000";
const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening");
});
