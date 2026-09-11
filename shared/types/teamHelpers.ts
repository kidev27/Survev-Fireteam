/** Room code without a leading `#`. Join URLs, hashes, and WS payloads all use this. */
export function normalizeTeamRoomKey(roomUrl: string): string {
    return (roomUrl || "").replace(/^#/, "");
}

/** Fields the client is allowed to send in create / setRoomProps. */
export function clientRoomPayload(room: {
    roomUrl: string;
    findingGame: boolean;
    lastError?: string | null;
    region: string;
    autoFill: boolean;
    gameModeIdx: number;
    mapName: string;
    difficulty?: string;
    endless?: boolean;
    squadSize?: number;
    squadName?: string;
}) {
    return {
        roomUrl: room.roomUrl,
        findingGame: !!room.findingGame,
        lastError: room.lastError ?? undefined,
        region: room.region,
        autoFill: !!room.autoFill,
        gameModeIdx: room.gameModeIdx,
        mapName: room.mapName || "random",
        difficulty: room.difficulty,
        endless: !!room.endless,
        squadSize: room.squadSize,
        squadName: room.squadName ?? "",
    };
}

export interface TeamPlayerIdentity {
    disconnected: boolean;
    userId: string | null;
    /** Per-tab lobby id. Seats are keyed by this, never by display name. */
    clientId: string;
    name: string;
    ip: string;
}

export type TeamJoinIncoming = {
    userId: string | null;
    clientId: string;
    name?: string;
    ip?: string;
};

export type TeamJoinDecision =
    | { type: "reclaim"; index: number }
    | { type: "join" }
    | { type: "full" };

function normalizeClientId(id: string | undefined | null): string {
    return (id || "").trim();
}

/**
 * Slot to reuse on join/reconnect.
 *
 * Identity is `clientId` (tab/session) then `userId` (logged-in account).
 * Display name is never a key — callnames are not unique accounts.
 *
 * Live-slot takeover is only for the same client reconnecting before the old
 * socket close is processed. A new player with the same name (even same IP)
 * always gets a new seat.
 */
export function findTeamPlayerReclaimIndex(
    players: TeamPlayerIdentity[],
    incoming: TeamJoinIncoming,
): number {
    const clientId = normalizeClientId(incoming.clientId);
    if (clientId) {
        const disc = players.findIndex(
            (p) => p.disconnected && normalizeClientId(p.clientId) === clientId,
        );
        if (disc >= 0) return disc;
        const live = players.findIndex(
            (p) => !p.disconnected && normalizeClientId(p.clientId) === clientId,
        );
        if (live >= 0) return live;
    }

    if (incoming.userId) {
        const disc = players.findIndex(
            (p) => p.disconnected && p.userId === incoming.userId,
        );
        if (disc >= 0) return disc;
        // Legacy clients with no clientId: take over a live slot of the same
        // account so a reconnect-before-close is not join_full. Two tabs that
        // each have a clientId must not steal each other's live seat.
        if (!clientId) {
            return players.findIndex(
                (p) => !p.disconnected && p.userId === incoming.userId,
            );
        }
    }

    return -1;
}

/**
 * Decide whether an incoming connection reclaims a seat, is added, or is full.
 * Used by the server and tests so "same name" / "third player" cannot steal slots.
 */
export function resolveTeamJoinSlot(
    players: TeamPlayerIdentity[],
    incoming: TeamJoinIncoming,
    maxPlayers: number,
): TeamJoinDecision {
    const index = findTeamPlayerReclaimIndex(players, incoming);
    if (index >= 0) return { type: "reclaim", index };
    const connected = players.filter((p) => !p.disconnected).length;
    if (connected >= maxPlayers) return { type: "full" };
    return { type: "join" };
}

/**
 * Apply a join to a seat list the same way Room.addPlayer does, without sockets.
 * Tests use this to assert existing identities stay connected.
 */
export function applyTeamJoin(
    players: TeamPlayerIdentity[],
    incoming: TeamPlayerIdentity,
    maxPlayers: number,
): TeamJoinDecision & { replacedClientId?: string } {
    const decision = resolveTeamJoinSlot(players, incoming, maxPlayers);
    if (decision.type === "reclaim") {
        const replaced = players[decision.index]!;
        players[decision.index] = { ...incoming, disconnected: false };
        return { ...decision, replacedClientId: replaced.clientId };
    }
    if (decision.type === "join") {
        players.push({ ...incoming, disconnected: false });
    }
    return decision;
}
