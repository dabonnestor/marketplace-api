import { config } from "./shared/config.js";
import { logger } from "./shared/logger.js";
import { createApp } from "./app.js";

const app = createApp();

app.listen(config.PORT, () => {
  logger.info(`Marketplace API running on http://localhost:${config.PORT}`);
  logger.info(`Health check: http://localhost:${config.PORT}/api/health`);
});
