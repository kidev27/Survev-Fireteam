import { Config } from "../../server/src/config.ts";
import { Game } from "../../server/src/game/game.ts";
import type { MapDefKey } from "../../shared/defs/mapDefs.ts";
import type { SpecOpsDifficulty } from "../../shared/defs/maps/specOpsShop.ts";
import type { TeamMode } from "../../shared/gameConfig.ts";

export function createGame(
    teamMode: TeamMode,
    mapName: MapDefKey,
    opts?: { difficulty?: SpecOpsDifficulty; endless?: boolean },
) {
    // we dont want vitest spammed with stdout logs so only log warns and errors
    Config.logging.logDate = false;
    Config.logging.debugLogs = false;
    Config.logging.infoLogs = false;
    Config.logging.warnLogs = true;
    Config.logging.errorLogs = true;

    const game = new Game("test", {
        mapName,
        teamMode,
        difficulty: opts?.difficulty ?? "regular",
        // Late-wave tests jump past 30; default continuous waves so they keep spawning.
        endless: opts?.endless ?? true,
    });
    return game;
}
