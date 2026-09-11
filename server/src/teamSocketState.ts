/**
 * Hono's Bun adapter constructs a new WSContext on every open/message/close.
 * `ws.raw` is the persistent Bun ServerWebSocket — never overwrite it, and
 * never store Player on the ephemeral context. Doing so created a ghost Player
 * whose 15s "didn't join a room" timer closed the live lobby socket.
 */

export interface TeamSocketState<P = unknown> {
    rateLimit: Record<symbol, number>;
    player?: P;
    ip: string;
}

type WsLike = { raw?: unknown };

const socketDataByRaw = new WeakMap<object, TeamSocketState>();

function socketRaw(ws: WsLike): object | undefined {
    const raw = ws.raw;
    return raw && typeof raw === "object" ? raw : undefined;
}

export function getTeamSocketData<P = unknown>(
    ws: WsLike,
): TeamSocketState<P> | undefined {
    const raw = socketRaw(ws);
    return raw ? socketDataByRaw.get(raw) as TeamSocketState<P> | undefined : undefined;
}

export function bindTeamSocketData<P>(
    ws: WsLike,
    data: TeamSocketState<P>,
): TeamSocketState<P> {
    const raw = socketRaw(ws);
    if (raw) socketDataByRaw.set(raw, data);
    return data;
}

export function ensureTeamSocketData<P = unknown>(
    ws: WsLike,
    ip: string,
): TeamSocketState<P> {
    const existing = getTeamSocketData<P>(ws);
    if (existing) {
        if (!existing.ip) existing.ip = ip;
        return existing;
    }
    return bindTeamSocketData<P>(ws, { rateLimit: {}, ip });
}
