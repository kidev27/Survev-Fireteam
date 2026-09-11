import { z } from "zod";
import type { MapDefKey } from "../../../shared/defs/mapDefs.ts";
import type { SpecOpsDifficulty } from "../../../shared/defs/maps/specOpsShop.ts";
import { TeamMode } from "../../../shared/gameConfig.ts";
import { type FindGamePrivateError, loadoutSchema } from "../../../shared/types/api.ts";
import type { MatchDataTable } from "../api/db/schema.ts";

export const zHandshakeBody = z.object({
    /** Server id shown in the client's Server dropdown (e.g. ft1). */
    regionId: z.string().min(1).max(64),
    /** Display name (e.g. "Fireteam 1"). */
    name: z.string().min(1).max(64).optional(),
    /**
     * Player-facing endpoint: https://host, http://ip:port, or host[:port].
     * Used for pings / menu listing; match WS still comes from find_game.
     */
    url: z.string().min(1).max(256).optional(),
    /**
     * Host:port the master API uses to call this game manager (plain HTTP).
     * Must be reachable from the master — not 127.0.0.1 on a remote node.
     */
    address: z.string().min(1).max(256),
});
export type HandshakeBody = z.infer<typeof zHandshakeBody>;

export const zUpdateRegionBody = z.object({
    regionId: z.string(),
    data: z.object({
        playerCount: z.number(),
        publicGames: z.array(z.object({
            gameId: z.string(),
            mapName: z.string(),
            teamMode: z.number(),
            players: z.number(),
            maxPlayers: z.number(),
            timeRunning: z.number(),
            canJoin: z.boolean(),
        })).optional(),
    }),
});
export type UpdateRegionBody = z.infer<typeof zUpdateRegionBody>;

export const zSetGameModeBody = z.object({
    index: z.number(),
    team_mode: z.enum(TeamMode).optional(),
    map_name: z.string().optional(),
    enabled: z.boolean().optional(),
});

export const zSetClientThemeBody = z.object({
    theme: z.string(),
});

export interface SaveGameBody {
    matchData: (MatchDataTable & {
        ip: string;
        findGameIp: string;
        wavesSurvived?: number;
    })[];
}

export interface ServerGameConfig {
    readonly mapName: MapDefKey;
    readonly teamMode: TeamMode;
    /** Squad cap for this match (2–8). Duo/solo ignore this. */
    readonly squadSize?: number;
    readonly difficulty?: SpecOpsDifficulty;
    readonly endless?: boolean;
    /** Mid-wave Spec Ops contracts. Default true. */
    readonly contractsEnabled?: boolean;
}

export const zFindGamePrivateBody = z.object({
    region: z.string(),
    version: z.number(),
    autoFill: z.boolean(),
    mapName: z.string(),
    teamMode: z.number(),
    squadSize: z.number().int().min(2).max(8).optional(),
    difficulty: z.string().optional(),
    endless: z.boolean().optional(),
    contractsEnabled: z.boolean().optional(),
    /** Fireteam name for duo/squad Spec Ops leaderboards. */
    squadName: z.string().max(32).optional(),
    gameId: z.string().optional(),
    playerData: z.array(
        z.object({
            token: z.string(),
            userId: z.string().nullable(),
            ip: z.string(),
            loadout: loadoutSchema.optional(),
            quests: z.array(z.string()).optional(),
            /** Spec Ops / reload: reclaim this in-game player id when possible. */
            reclaimPlayerId: z.number().int().positive().optional(),
        }),
    ),
});

export type FindGamePrivateBody = z.infer<typeof zFindGamePrivateBody>;

export type FindGamePrivateRes =
    | {
        gameId: string;
        urls: string[];
    }
    | { error: FindGamePrivateError };
