/**
 * E2E: create squad of 8, start match, connect all 8 to game WS.
 * Run: bun scripts/test-8player-e2e.ts
 */
import { GameConfig } from "../shared/gameConfig.ts";
import * as net from "../shared/net/net.ts";

const TEAM_WS = "ws://127.0.0.1:8000/team_v2";
const N = 8;

function waitMsg(
    ws: WebSocket,
    pred: (msg: { type: string; data?: unknown }) => boolean,
    ms = 8000,
): Promise<{ type: string; data?: any }> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout waiting for message")), ms);
        const onMsg = (ev: MessageEvent) => {
            let msg: { type: string; data?: unknown };
            try {
                msg = JSON.parse(String(ev.data));
            } catch {
                return;
            }
            if (pred(msg)) {
                clearTimeout(t);
                ws.removeEventListener("message", onMsg);
                resolve(msg);
            }
        };
        ws.addEventListener("message", onMsg);
    });
}

function connect(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        ws.onopen = () => resolve(ws);
        ws.onerror = () => reject(new Error(`ws error ${url}`));
        setTimeout(() => reject(new Error(`open timeout ${url}`)), 8000);
    });
}

function encodeJoin(matchPriv: string, name: string): ArrayBuffer {
    const joinMessage = new net.JoinMsg();
    joinMessage.protocol = GameConfig.protocolVersion;
    joinMessage.matchPriv = matchPriv;
    joinMessage.name = name;
    joinMessage.useTouch = false;
    joinMessage.isMobile = false;
    joinMessage.bot = false;
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

function resolveGameUrl(urls: string[] | undefined, gameId: string): string {
    const raw = urls?.[0] ?? "";
    const m = raw.match(/\/g\/(\d+)\/play/);
    const port = m?.[1] ?? "9000";
    const q = gameId ? `?gameId=${encodeURIComponent(gameId)}` : "";
    return `ws://127.0.0.1:${port}/play${q}`;
}

type Result = {
    i: number;
    ok: boolean;
    stage: string;
    err?: unknown;
    got?: unknown;
};

const sockets: WebSocket[] = [];
const teamErrors: unknown[] = [];
const results: Result[] = [];

try {
    const host = await connect(TEAM_WS);
    sockets.push(host);
    host.addEventListener("message", (ev) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === "error") teamErrors.push({ who: "host", err: msg.data });
    });

    host.send(
        JSON.stringify({
            type: "create",
            data: {
                roomData: {
                    roomUrl: "",
                    findingGame: false,
                    lastError: null,
                    region: "main",
                    autoFill: false,
                    gameModeIdx: 2,
                    mapName: "random",
                    difficulty: "recruit",
                    endless: true,
                    squadSize: 8,
                },
                playerData: { name: "Op0", clientId: "e2e-op-0" },
            },
        }),
    );

    const hostState = await waitMsg(host, (m) => m.type === "state");
    const roomUrl = hostState.data.room.roomUrl as string;
    console.log("lobby", {
        roomUrl,
        maxPlayers: hostState.data.room.maxPlayers,
        squadSize: hostState.data.room.squadSize,
    });

    const joiners: WebSocket[] = [];
    for (let i = 1; i < N; i++) {
        const ws = await connect(TEAM_WS);
        sockets.push(ws);
        joiners.push(ws);
        const who = `op${i}`;
        ws.addEventListener("message", (ev) => {
            const msg = JSON.parse(String(ev.data));
            if (msg.type === "error") teamErrors.push({ who, err: msg.data });
        });
        const sp = waitMsg(ws, (m) => m.type === "state");
        ws.send(
            JSON.stringify({
                type: "join",
                data: {
                    roomUrl,
                    playerData: { name: `Op${i}`, clientId: `e2e-op-${i}` },
                },
            }),
        );
        await sp;
    }
    console.log("all in lobby");

    const allTeam = [host, ...joiners];
    const joinGameWaiters = allTeam.map((ws, i) =>
        waitMsg(
            ws,
            (m) =>
                m.type === "joinGame"
                || m.type === "error"
                || (m.type === "state"
                    && !!(m.data as { room?: { lastError?: string } })?.room?.lastError),
            25000,
        ).then((m) => ({ i, m }))
    );

    host.send(
        JSON.stringify({
            type: "playGame",
            data: {
                version: GameConfig.protocolVersion,
                region: "main",
                zones: ["main"],
            },
        }),
    );

    const joinGames = await Promise.all(joinGameWaiters);
    for (const { i, m } of joinGames) {
        if (m.type === "error") {
            console.error("play error for", i, m.data);
            results.push({ i, ok: false, stage: "joinGame", err: m.data });
            continue;
        }
        if (m.type === "state") {
            console.error("state lastError for", i, m.data?.room?.lastError);
            results.push({
                i,
                ok: false,
                stage: "findGame",
                err: m.data?.room?.lastError,
            });
            continue;
        }
        const token = m.data.data as string;
        const gameId = m.data.gameId as string;
        const urls = m.data.urls as string[];
        const gameUrl = resolveGameUrl(urls, gameId);
        console.log("op", i, "joinGame", {
            gameId,
            urls,
            gameUrl,
            token: token?.slice(0, 8),
        });

        try {
            const gws = await connect(gameUrl);
            sockets.push(gws);
            const got = await new Promise<{
                type: string;
                reason?: string;
                code?: number;
                playerId?: number;
            }>((resolve, reject) => {
                const t = setTimeout(() => reject(new Error("no Joined msg")), 10000);
                gws.onmessage = (ev) => {
                    try {
                        const ms = new net.MsgStream(ev.data as ArrayBuffer);
                        while (true) {
                            const type = ms.deserializeMsgType();
                            if (type === net.MsgType.None) break;
                            if (type === net.MsgType.Joined) {
                                const joined = new net.JoinedMsg();
                                joined.deserialize(ms.getStream());
                                clearTimeout(t);
                                resolve({ type: "Joined", playerId: joined.playerId });
                                return;
                            }
                            ms.stream.readAlignToNextByte();
                        }
                    } catch {
                        // ignore
                    }
                };
                gws.onclose = (e) => {
                    clearTimeout(t);
                    resolve({ type: "closed", reason: e.reason, code: e.code });
                };
                gws.send(encodeJoin(token, `Op${i}`));
            });
            console.log("op", i, "game result", got);
            results.push({ i, ok: got.type === "Joined", stage: "game", got });
            // Keep sockets open until all ops finish joining so seats stay occupied.
        } catch (e) {
            console.error("op", i, "game connect fail", e);
            results.push({ i, ok: false, stage: "game", err: String(e) });
        }
    }

    const ok = results.filter((r) => r.ok).length;
    const playerIds = results
        .map((r) => (r.got as { playerId?: number } | undefined)?.playerId)
        .filter((id): id is number => typeof id === "number");
    const uniqueIds = new Set(playerIds);
    console.log("SUMMARY", {
        ok,
        total: N,
        uniquePlayerIds: uniqueIds.size,
        playerIds,
        teamErrors,
        results,
    });
    if (ok !== N || uniqueIds.size !== N) process.exitCode = 1;
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
    await new Promise((r) => setTimeout(r, 200));
}
