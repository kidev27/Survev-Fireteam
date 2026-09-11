/**
 * E2E: 8-player squad lobby → start match → reconnect each seat one-by-one.
 *
 * Success: every operator gets Joined again after disconnect (same playerId).
 * Failure: any seat fails to reclaim.
 *
 * Requires `bun run dev` (API :8000 + game).
 * Run: bun scripts/test-8player-reconnect-e2e.ts
 */
import { GameConfig } from "../shared/gameConfig.ts";
import * as net from "../shared/net/net.ts";

const TEAM_WS = "ws://127.0.0.1:8000/team_v2";
const N = 8;
const REGION = "main";

function waitMsg(
    ws: WebSocket,
    pred: (msg: { type: string; data?: unknown }) => boolean,
    ms = 12_000,
): Promise<{ type: string; data?: any }> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(
            () => reject(new Error(`timeout waiting for message (${ms}ms)`)),
            ms,
        );
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
        setTimeout(() => reject(new Error(`open timeout ${url}`)), 10_000);
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

async function joinGameSocket(
    gameUrl: string,
    token: string,
    name: string,
): Promise<{
    type: string;
    playerId?: number;
    reason?: string;
    code?: number;
    ws?: WebSocket;
}> {
    const gws = await connect(gameUrl);
    return await new Promise((resolve, reject) => {
        const t = setTimeout(() => {
            try {
                gws.close();
            } catch {
                // ignore
            }
            reject(new Error("no Joined msg"));
        }, 12_000);

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
                        resolve({
                            type: "Joined",
                            playerId: joined.playerId,
                            ws: gws,
                        });
                        return;
                    }
                    ms.stream.readAlignToNextByte();
                }
            } catch {
                // ignore partial frames
            }
        };
        gws.onclose = (e) => {
            clearTimeout(t);
            resolve({ type: "closed", reason: e.reason, code: e.code });
        };
        gws.send(encodeJoin(token, name));
    });
}

type Seat = {
    i: number;
    name: string;
    teamWs: WebSocket;
    gameWs: WebSocket | null;
    playerId: number | null;
    gameId: string;
    urls: string[];
};

const sockets: WebSocket[] = [];
const teamErrors: unknown[] = [];

function track(ws: WebSocket) {
    sockets.push(ws);
    return ws;
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

try {
    console.log(`=== 8-player reconnect e2e (N=${N}) ===`);

    const host = track(await connect(TEAM_WS));
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
                    region: REGION,
                    autoFill: false,
                    gameModeIdx: 2,
                    mapName: "random",
                    difficulty: "recruit",
                    endless: true,
                    squadSize: 8,
                    squadName: "E2E8",
                },
                playerData: { name: "Op0", clientId: "e2e-rejoin-0" },
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
    if ((hostState.data.room.maxPlayers as number) < N) {
        throw new Error(
            `lobby maxPlayers=${hostState.data.room.maxPlayers} < ${N} — check maxSquadSize`,
        );
    }

    const seats: Seat[] = [
        {
            i: 0,
            name: "Op0",
            teamWs: host,
            gameWs: null,
            playerId: null,
            gameId: "",
            urls: [],
        },
    ];

    for (let i = 1; i < N; i++) {
        const ws = track(await connect(TEAM_WS));
        const who = `op${i}`;
        ws.addEventListener("message", (ev) => {
            const msg = JSON.parse(String(ev.data));
            if (msg.type === "error") teamErrors.push({ who, err: msg.data });
        });
        const sp = waitMsg(ws, (m) => m.type === "state" && (m.data as any)?.players?.length >= i + 1);
        ws.send(
            JSON.stringify({
                type: "join",
                data: {
                    roomUrl,
                    playerData: { name: `Op${i}`, clientId: `e2e-rejoin-${i}` },
                },
            }),
        );
        await sp;
        seats.push({
            i,
            name: `Op${i}`,
            teamWs: ws,
            gameWs: null,
            playerId: null,
            gameId: "",
            urls: [],
        });
    }
    console.log("all in lobby");

    const joinGameWaiters = seats.map((seat) =>
        waitMsg(
            seat.teamWs,
            (m) =>
                m.type === "joinGame"
                || m.type === "error"
                || (m.type === "state"
                    && !!(m.data as { room?: { lastError?: string } })?.room?.lastError),
            30_000,
        ).then((m) => ({ seat, m }))
    );

    host.send(
        JSON.stringify({
            type: "playGame",
            data: {
                version: GameConfig.protocolVersion,
                region: REGION,
                zones: [REGION],
            },
        }),
    );

    const joinGames = await Promise.all(joinGameWaiters);
    for (const { seat, m } of joinGames) {
        if (m.type === "error") {
            throw new Error(`play error for ${seat.name}: ${JSON.stringify(m.data)}`);
        }
        if (m.type === "state") {
            throw new Error(
                `findGame lastError for ${seat.name}: ${m.data?.room?.lastError}`,
            );
        }
        const token = m.data.data as string;
        const gameId = m.data.gameId as string;
        const urls = m.data.urls as string[];
        seat.gameId = gameId;
        seat.urls = urls;
        const gameUrl = resolveGameUrl(urls, gameId);
        console.log("join", seat.name, { gameId, gameUrl, token: token?.slice(0, 8) });

        const got = await joinGameSocket(gameUrl, token, seat.name);
        if (got.type !== "Joined" || typeof got.playerId !== "number") {
            throw new Error(
                `initial join failed for ${seat.name}: ${JSON.stringify(got)}`,
            );
        }
        seat.playerId = got.playerId;
        seat.gameWs = got.ws ?? null;
        if (got.ws) track(got.ws);
        console.log("joined", seat.name, "playerId", seat.playerId);
    }

    const uniqueIds = new Set(seats.map((s) => s.playerId));
    if (uniqueIds.size !== N) {
        throw new Error(`expected ${N} unique playerIds, got ${uniqueIds.size}`);
    }
    console.log("all 8 in match — beginning one-by-one reconnect");

    const reconnectResults: Array<{
        name: string;
        ok: boolean;
        beforeId: number | null;
        afterId?: number;
        err?: string;
    }> = [];

    for (const seat of seats) {
        const beforeId = seat.playerId;
        console.log(`\n--- reconnect ${seat.name} (playerId ${beforeId}) ---`);

        try {
            // Drop match socket (simulate crash / tab close).
            if (seat.gameWs) {
                try {
                    seat.gameWs.close();
                } catch {
                    // ignore
                }
                seat.gameWs = null;
            }
            await sleep(600);

            const joinWait = waitMsg(
                seat.teamWs,
                (m) => m.type === "joinGame" || m.type === "error",
                20_000,
            );
            seat.teamWs.send(JSON.stringify({
                type: "rejoinMatch",
                data: { playerId: beforeId, playerName: seat.name },
            }));
            const m = await joinWait;
            if (m.type === "error") {
                throw new Error(`rejoinMatch error: ${JSON.stringify(m.data)}`);
            }

            const token = m.data.data as string;
            const gameId = (m.data.gameId as string) || seat.gameId;
            const urls = (m.data.urls as string[]) || seat.urls;
            const gameUrl = resolveGameUrl(urls, gameId);
            console.log("rejoin token", {
                gameId,
                gameUrl,
                token: token?.slice(0, 8),
            });

            const got = await joinGameSocket(gameUrl, token, seat.name);

            if (got.type !== "Joined" || typeof got.playerId !== "number") {
                throw new Error(`reconnect Joined failed: ${JSON.stringify(got)}`);
            }

            seat.playerId = got.playerId;
            seat.gameWs = got.ws ?? null;
            if (got.ws) track(got.ws);

            const sameSeat = got.playerId === beforeId;
            console.log(
                sameSeat
                    ? `OK ${seat.name} reclaimed playerId ${got.playerId}`
                    : `WARN ${seat.name} Joined but playerId ${beforeId} → ${got.playerId}`,
            );

            // Treat Joined as reconnect success; same playerId is the strong check.
            reconnectResults.push({
                name: seat.name,
                ok: sameSeat,
                beforeId,
                afterId: got.playerId,
                err: sameSeat ? undefined : "playerId changed (new seat, not reclaim)",
            });
        } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            console.error(`FAIL ${seat.name}:`, err);
            reconnectResults.push({
                name: seat.name,
                ok: false,
                beforeId,
                err,
            });
        }
    }

    const okCount = reconnectResults.filter((r) => r.ok).length;
    console.log("\n=== RECONNECT SUMMARY ===");
    console.log({
        ok: okCount,
        total: N,
        teamErrors,
        results: reconnectResults,
    });

    if (okCount === N) {
        console.log("SUCCESS — all 8 reconnected to their seats");
    } else {
        console.error(
            `FAILURE — ${N - okCount}/${N} did not reclaim their seat`,
        );
        process.exitCode = 1;
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
    await sleep(250);
}
