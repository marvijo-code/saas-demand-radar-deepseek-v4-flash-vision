import { openDatabase, runMigrations } from "./db/index.js";
import { seedDatabase } from "./db/migrate.js";
import { createApp } from "./app.js";
import { getConfig } from "./config.js";

const config = getConfig();
const db = openDatabase();
runMigrations(db);
seedDatabase(db);

const app = createApp(db);

app.listen(config.serverPort, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://127.0.0.1:${config.serverPort}`);
});
