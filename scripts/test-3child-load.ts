/**
 * Load-test: master + 3 child game nodes, random player counts per region.
 * Expects cluster already running (see scripts/test-cluster/start.mjs).
 *
 * Run: bun scripts/test-3child-load.ts
 */
import { randomUUID } from "node:crypto";
import { GameConfig, TeamMode } from "../shared/gameConfig.ts";
import * as net from "../shared/net/net.ts";

const API = "http://127.0.0.1:8000";
/** Same key as secrets.SURVEV_API_KEY in the cluster configs. */
const API_KEY = process.env.SURVEV_API_KEY?.trim() || "";
if (API_KEY.length < 16) {
    console.error("Set SURVEV_API_KEY (min 16 chars) to match the cluster secrets.");
    process.exit(1);
}

const CHILDREN = [
    { id: "ft1", mgr: 8101 },
    { id: "ft2", mgr: 8201 },
    { id: "ft3", mgr: 8301 },
] as const;

const HOLD_MS = 45_000;

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

function randPlayers(): number {
    return 2 + Math.floor(Math.random() * 7); // 2–8
}

function resolveGameUrl(urls: string[] | undefined, gameId: string): string {
    const raw = urls?.[0] ?? "";
    const m = raw.match(/\/g\/(\d+)\/play/);
    const port = m?.[1];
    if (!port) throw new Error(`bad game url: ${raw}`);
    const q = gameId ? `?gameId=${encodeURIComponent(gameId)}` : "";
    return `ws://127.0.0.1:${port}/play${q}`;
}

function encodeJoin(matchPriv: string, name: string, bot = true): ArrayBuffer {
    const joinMessage = new net.JoinMsg();
    joinMessage.protocol = GameConfig.protocolVersion;
    joinMessage.matchPriv = matchPriv;
    joinMessage.name = name;
    joinMessage.useTouch = false;
    joinMessage.isMobile = false;
    joinMessage.bot = bot;
    joinMessage.loadout = {
        outfit: "outfitBase",
        melee: "fists",
        heal: "heal_basic",
        boost: "boost_basic",
        emotes: ["", "", "", "", "", ""],
    };
    const stream = new net.MsgStream(new ArrayBuffer(8192));
    stream.serializeMsg(net.MsgType.Join, joinMessage);
    return stream.getBuffer();
}

function connectWs(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        ws.onopen = () => resolve(ws);
        ws.onerror = () => reject(new Error(`ws error ${url}`));
        setTimeout(() => reject(new Error(`open timeout ${url}`)), 12000);
    });
}

async function waitJoined(ws: WebSocket, token: string, name: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`no Joined for ${name}`)), 15000);
        ws.onmessage = (ev) => {
            try {
                const ms = new net.MsgStream(ev.data as ArrayBuffer);
                while (true) {
                    const type = ms.deserializeMsgType();
                    if (type === net.MsgType.None) break;
                    if (type === net.MsgType.Joined) {
                        const joined = new net.JoinedMsg();
                        joined.deserialize(ms.getStream());
                        clearTimeout(t);
                        resolve(joined.playerId);
                        return;
                    }
                    ms.stream.readAlignToNextByte();
                }
            } catch {
                // ignore partial frames
            }
        };
        ws.onclose = (e) => {
            clearTimeout(t);
            reject(new Error(`closed before Joined: ${e.code} ${e.reason}`));
        };
        ws.send(encodeJoin(token, name));
    });
}

async function privateStatus(mgrPort: number) {
    const res = await fetch(`http://127.0.0.1:${mgrPort}/private/status`, {
        headers: { "survev-api-key": API_KEY },
    });
    if (!res.ok) throw new Error(`status ${mgrPort}: ${res.status}`);
    return res.json() as Promise<{
        gameCount: number;
        games: Array<{
            state: string;
            port: number;
            gameData: {
                id: string;
                aliveCount: number;
                stopped: boolean;
                mapName: string;
            };
        }>;
    }>;
}

async function findOnChild(
    region: string,
    mgrPort: number,
    playerCount: number,
): Promise<{ gameId: string; urls: string[]; tokens: string[] }> {
    const tokens = Array.from({ length: playerCount }, () => randomUUID());
    const body = {
        region,
        version: GameConfig.protocolVersion,
        autoFill: false,
        mapName: "specops",
        teamMode: TeamMode.Squad,
        squadSize: 8,
        difficulty: "recruit",
        endless: true,
        contractsEnabled: true,
        squadName: `Load${region}`,
        playerData: tokens.map((token, i) => ({
            token,
            userId: null,
            ip: `127.0.0.${(i % 200) + 1}`,
        })),
    };

    const res = await fetch(`http://127.0.0.1:${mgrPort}/api/find_game`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "survev-api-key": API_KEY,
        },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
        throw new Error(`find_game ${region}: ${JSON.stringify(data)}`);
    }
    return { gameId: data.gameId, urls: data.urls, tokens };
}

async function siteInfoPops(): Promise<string[]> {
    const res = await fetch(`${API}/api/site_info`);
    if (!res.ok) throw new Error(`site_info ${res.status}`);
    const json = await res.json() as { pops?: Record<string, unknown> };
    return Object.keys(json.pops ?? {});
}

type RegionResult = {
    region: string;
    players: number;
    joined: number;
    gameId: string;
    alivePeak: number;
    statusOk: boolean;
    err?: string;
};

const sockets: WebSocket[] = [];
const results: RegionResult[] = [];

try {
    console.log("Waiting for master + children…");
    let pops: string[] = [];
    for (let i = 0; i < 30; i++) {
        try {
            pops = await siteInfoPops();
            if (CHILDREN.every((c) => pops.includes(c.id))) break;
        } catch {
            // retry
        }
        await sleep(1000);
    }
    console.log("site_info pops:", pops);
    for (const c of CHILDREN) {
        if (!pops.includes(c.id)) {
            throw new Error(`region ${c.id} missing from site_info after wait`);
        }
    }

    // Stagger finds so map gen doesn't stampede one core
    for (const child of CHILDREN) {
        const n = randPlayers();
        console.log(`\n=== ${child.id}: spawning ${n} players ===`);
        try {
            const found = await findOnChild(child.id, child.mgr, n);
            const gameUrl = resolveGameUrl(found.urls, found.gameId);
            console.log("find ok", { gameId: found.gameId.slice(0, 8), gameUrl, n });

            let joined = 0;
            const ids: number[] = [];
            for (let i = 0; i < n; i++) {
                const ws = await connectWs(gameUrl);
                sockets.push(ws);
                const pid = await waitJoined(ws, found.tokens[i]!, `${child.id}_${i}`);
                ids.push(pid);
                joined++;
            }
            console.log("joined", { joined, playerIds: ids });

            results.push({
                region: child.id,
                players: n,
                joined,
                gameId: found.gameId,
                alivePeak: 0,
                statusOk: true,
            });
        } catch (e) {
            console.error(child.id, "FAILED", e);
            results.push({
                region: child.id,
                players: n,
                joined: 0,
                gameId: "",
                alivePeak: 0,
                statusOk: false,
                err: String(e),
            });
        }
        await sleep(500);
    }

    console.log(`\nHolding ${HOLD_MS / 1000}s — monitoring child status / alive counts…`);
    const samples = 9;
    for (let s = 0; s < samples; s++) {
        for (const child of CHILDREN) {
            const r = results.find((x) => x.region === child.id);
            if (!r?.statusOk) continue;
            try {
                const st = await privateStatus(child.mgr);
                const alive = st.games.reduce((a, g) => a + (g.gameData.aliveCount || 0), 0);
                r.alivePeak = Math.max(r.alivePeak, alive);
                console.log(
                    `[${s + 1}/${samples}] ${child.id}: games=${st.gameCount} alive=${alive} states=${
                        st.games.map((g) => g.state).join(",") || "-"
                    }`,
                );
            } catch (e) {
                r.statusOk = false;
                r.err = String(e);
                console.error(child.id, "status fail", e);
            }
        }
        await sleep(HOLD_MS / samples);
    }

    // Master should show combined pops
    const finalPops = await (await fetch(`${API}/api/site_info`)).json();
    console.log("\nfinal site_info pops:", finalPops.pops);

    console.log("\nSUMMARY");
    for (const r of results) {
        console.log(r);
    }

    const allOk = results.every((r) => r.statusOk && r.joined === r.players && r.joined > 0);
    if (!allOk) {
        console.error("LOAD TEST FAILED");
        process.exitCode = 1;
    } else {
        console.log("LOAD TEST OK — all children accepted random squads and stayed up");
    }
} catch (e) {
    console.error("FATAL", e);
    process.exitCode = 1;
} finally {
    for (const ws of sockets) {
        try {
            ws.close();
        } catch {
            // ignore
        }
    }
    await sleep(300);
}
