import path from "node:path";
import { getConfig } from "../../config.ts";

export {
    clampMaxSquadSize,
    configFileName,
    expandGameModes,
    loadedConfigPath,
    maxPlayersForMap,
    postgresPoolConfig,
    teamSizeForMode,
} from "../../config.ts";

const isProd = process.env["NODE_ENV"] === "production";
/** Repo root (server/src or server/dist → ../..). */
export const serverConfigPath = path.resolve(import.meta.dirname, "../..");
export const Config = getConfig(isProd, serverConfigPath);
