import { Config, postgresPoolConfig } from "../../config.ts";
import { server } from "../apiServer.ts";
import { isMongo, isMysql, isPostgres } from "./dialect.ts";
import type * as pgSchema from "./schema.pg.ts";

type SqlDb = ReturnType<typeof import("drizzle-orm/node-postgres").drizzle<typeof pgSchema>>;
type MysqlPool = import("mysql2/promise").Pool;
type MongoDb = import("mongodb").Db;

let sqlDb: SqlDb | undefined;
let mysqlPool: MysqlPool | undefined;
let mongoClient: import("mongodb").MongoClient | undefined;
let mongoDb: MongoDb | undefined;

async function createPostgresDb(): Promise<SqlDb> {
    const [{ drizzle }, pg, schema] = await Promise.all([
        import("drizzle-orm/node-postgres"),
        import("pg"),
        import("./schema.pg.ts"),
    ]);
    const poolConnection = new pg.default.Pool({
        ...postgresPoolConfig(Config.database),
        idleTimeoutMillis: 60 * 1000,
    });
    poolConnection.on("connect", () => {
        server.logger.info("Connected to PostgreSQL");
    });
    poolConnection.on("error", (err) => {
        server.logger.error("pg pool error:", err);
    });
    return drizzle({ client: poolConnection, schema });
}

async function createMysqlDb(): Promise<SqlDb> {
    const [{ drizzle }, mysql, schema] = await Promise.all([
        import("drizzle-orm/mysql2"),
        import("mysql2/promise"),
        import("./schema.mysql.ts"),
    ]);
    mysqlPool = mysql.createPool({
        host: Config.database.host,
        port: Config.database.port || 3306,
        user: Config.database.user,
        password: Config.database.password,
        database: Config.database.database,
        waitForConnections: true,
        connectionLimit: 10,
        enableKeepAlive: true,
    });
    server.logger.info(
        `Connecting to MariaDB at ${Config.database.host}:${Config.database.port || 3306}`,
    );
    return drizzle({
        client: mysqlPool,
        schema,
        mode: "default",
    }) as unknown as SqlDb;
}

export async function connectMongo(): Promise<MongoDb> {
    if (mongoDb) return mongoDb;
    const { MongoClient } = await import("mongodb");
    const uri = Config.database.uri?.trim()
        || `mongodb://${Config.database.host}:${Config.database.port || 27017}/${Config.database.database}`;
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    mongoDb = mongoClient.db(Config.database.database);
    server.logger.info("Connected to MongoDB");
    await ensureMongoIndexes(mongoDb);
    return mongoDb;
}

export function getMongoDb(): MongoDb {
    if (!mongoDb) {
        throw new Error("MongoDB not connected — call initAccountsDatabase() at API startup");
    }
    return mongoDb;
}

async function ensureMongoIndexes(database: MongoDb) {
    await database.collection("users").createIndexes([
        { key: { slug: 1 }, unique: true },
        { key: { authId: 1 } },
    ]);
    await database.collection("session").createIndexes([
        { key: { userId: 1 } },
        { key: { expiresAt: 1 } },
    ]);
    await database.collection("items").createIndexes([
        { key: { userId: 1, type: 1 }, unique: true },
    ]);
    await database.collection("user_pass").createIndexes([
        { key: { userId: 1, passType: 1 }, unique: true },
    ]);
    await database.collection("user_quest").createIndexes([
        { key: { userId: 1, idx: 1 }, unique: true },
    ]);
    await database.collection("match_data").createIndexes([
        { key: { gameId: 1, playerId: 1 }, unique: true },
        { key: { userId: 1, teamMode: 1 } },
        { key: { teamMode: 1, mapId: 1, createdAt: -1 } },
        { key: { wavesSurvived: -1 } },
    ]);
    await database.collection("ip_logs").createIndexes([
        { key: { username: 1, createdAt: -1 } },
    ]);
    await database.collection("banned_ips").createIndexes([
        { key: { encodedIp: 1 }, unique: true },
    ]);
}

function getSqlDb(): SqlDb {
    if (!sqlDb) {
        throw new Error(
            Config.database.enabled && !isMongo()
                ? "Accounts DB not ready — wait for initAccountsDatabase()"
                : `SQL client unavailable (database.enabled=${Config.database.enabled}, engine=${Config.database.engine})`,
        );
    }
    return sqlDb;
}

/** Lazy Drizzle client for postgres / mariadb (only after initAccountsDatabase). */
export const db: SqlDb = new Proxy({} as SqlDb, {
    get(_target, prop, receiver) {
        const real = getSqlDb() as object;
        const value = Reflect.get(real, prop, receiver);
        return typeof value === "function" ? (value as Function).bind(real) : value;
    },
});

export async function initAccountsDatabase() {
    if (!Config.database.enabled) return;
    if (isMongo()) {
        await connectMongo();
        return;
    }
    if (isMysql()) {
        sqlDb = await createMysqlDb();
        if (mysqlPool) {
            const { ensureMysqlSchema } = await import("./mysqlBootstrap.ts");
            await ensureMysqlSchema(mysqlPool);
            server.logger.info("MariaDB schema ready");
        }
    } else if (isPostgres()) {
        sqlDb = await createPostgresDb();
    } else {
        throw new Error(`Unsupported SQL engine: ${Config.database.engine}`);
    }
    server.logger.info(
        `Accounts DB engine: ${Config.database.engine} `
            + `(${Config.database.host}:${Config.database.port}/${Config.database.database})`,
    );
}
