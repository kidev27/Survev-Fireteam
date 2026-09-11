import { util } from "../../utils/util.ts";
import type { MapDef } from "../mapDefs.ts";
import { Main, type PartialMapDef } from "./baseDefs.ts";
import { SpecOpsBagSizes } from "./specOpsShop.ts";

export const testNormal = util.mergeDeep(
    {},
    Main,
    {
        mapGen: {
            map: {
                baseWidth: 128,
                baseHeight: 128,
                rivers: {
                    lakes: [],
                    weights: [{ weight: 1, widths: [] }],
                    spawnCabins: false,
                },
            },
            customSpawnRules: {
                locationSpawns: [],
                placeSpawns: [],
            },
            densitySpawns: [{}],
            fixedSpawns: [{}],
            randomSpawns: [],
            spawnReplacements: [{}],
        },
    } satisfies PartialMapDef,
) as MapDef;

export const testFaction = util.mergeDeep(
    {},
    testNormal,
    {
        gameMode: {
            factionMode: true,
            factions: 2,
        },
    } satisfies PartialMapDef,
) as MapDef;

export const testSpecOps = util.mergeDeep(
    {},
    testNormal,
    {
        gameMode: {
            specOpsMode: true,
            maxPlayers: 4,
            killLeaderEnabled: true,
        },
        gameConfig: {
            planes: {
                timings: [],
            },
            bagSizes: SpecOpsBagSizes,
        },
        mapGen: {
            densitySpawns: [
                {
                    stone_01: 40,
                    tree_01: 40,
                    bush_01: 20,
                },
            ],
            fixedSpawns: [
                {
                    shack_01: 2,
                    hut_01: 1,
                    barn_02: 1,
                },
            ],
            randomSpawns: [],
            importantSpawns: [],
        },
    } satisfies PartialMapDef,
) as MapDef;

export const testSpecOpsBots = util.mergeDeep(
    {},
    testSpecOps,
    {
        desc: {
            name: "Spec Ops Bot Arena",
            icon: "img/gui/target.svg",
            buttonCss: "btn-mode-specops",
            buttonText: "Bot Debug",
            backgroundImg: "img/main_splash.png",
        },
        gameMode: {
            specOpsBotArena: true,
            killLeaderEnabled: false,
        },
        mapGen: {
            map: {
                baseWidth: 192,
                baseHeight: 192,
            },
            densitySpawns: [
                {
                    stone_01: 12,
                    tree_01: 16,
                    bush_01: 8,
                },
            ],
            fixedSpawns: [
                {
                    shack_01: 1,
                    specops_station_weapon: 1,
                    specops_station_gear: 1,
                    specops_station_armor: 1,
                    specops_station_support: 1,
                    specops_station_perk: 1,
                },
            ],
            randomSpawns: [],
            importantSpawns: [],
        },
    } satisfies PartialMapDef,
) as MapDef;
