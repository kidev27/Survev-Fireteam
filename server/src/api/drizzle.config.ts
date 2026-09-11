import { defineConfig } from "drizzle-kit";
import { Config } from "../config.ts";

const isMysql = Config.database.engine === "mariadb";

export default defineConfig({
    dialect: isMysql ? "mysql" : "postgresql",
    schema: isMysql ? "src/api/db/schema.mysql.ts" : "src/api/db/schema.pg.ts",
    out: isMysql ? "./src/api/db/drizzle-mysql" : "./src/api/db/drizzle",
    dbCredentials: {
        host: Config.database.host,
        port: Config.database.port,
        user: Config.database.user,
        password: Config.database.password,
        database: Config.database.database,
        ssl: false,
    },
});
