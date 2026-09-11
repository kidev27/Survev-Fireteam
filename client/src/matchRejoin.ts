import type { FindGameMatchData } from "../../shared/types/api.ts";

/** Match rejoin window — must match server join token TTL (90s). */
export const MATCH_REJOIN_TTL_MS = 90_000;

const MATCH_SESSION_KEY = "survev_match_rejoin";
const TEAM_LOBBY_KEY = "survev_team_lobby";

export interface ActiveMatchSession {
    gameId: string;
    region: string;
    gameModeIdx: number;
    playerName: string;
    /** In-game network player id from Joined (preferred reclaim key). */
    playerId?: number;
    teamRoomUrl?: string;
    /** Set when the match socket drops and rejoin is allowed. */
    expiresAt?: number;
    token?: string;
    urls?: string[];
}

export interface TeamLobbySession {
    roomUrl: string;
}

function readJson<T>(key: string): T | undefined {
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return undefined;
        return JSON.parse(raw) as T;
    } catch {
        return undefined;
    }
}

function writeJson(key: string, value: unknown): void {
    try {
        sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Private mode / quota — rejoin still works for same-tab reload via URL.
    }
}

function removeKey(key: string): void {
    try {
        sessionStorage.removeItem(key);
    } catch {
        // ignore
    }
}

/** Squad lobby code from session or saved team lobby (survives match-only storage). */
export function resolveTeamRoomUrl(
    session?: Pick<ActiveMatchSession, "teamRoomUrl">,
): string | undefined {
    const raw = session?.teamRoomUrl?.trim();
    if (raw) {
        return raw.startsWith("#") ? raw : `#${raw}`;
    }
    return getTeamLobbySession()?.roomUrl;
}

export function mergeRejoinSessions(
    urlSession?: ActiveMatchSession,
    stored?: ActiveMatchSession,
): ActiveMatchSession | undefined {
    if (!urlSession && !stored) return undefined;
    if (!stored) {
        return {
            ...urlSession!,
            teamRoomUrl: resolveTeamRoomUrl(urlSession),
        };
    }
    if (!urlSession) {
        return {
            ...stored,
            teamRoomUrl: resolveTeamRoomUrl(stored),
        };
    }

    const expiresAt = Math.max(stored.expiresAt ?? 0, urlSession.expiresAt ?? 0) || undefined;

    return {
        ...stored,
        gameId: urlSession.gameId || stored.gameId,
        region: urlSession.region || stored.region,
        gameModeIdx: Number.isFinite(urlSession.gameModeIdx)
            ? urlSession.gameModeIdx
            : stored.gameModeIdx,
        playerName: stored.playerName || urlSession.playerName,
        playerId: stored.playerId ?? urlSession.playerId,
        token: stored.token ?? urlSession.token,
        urls: stored.urls ?? urlSession.urls,
        expiresAt,
        teamRoomUrl: resolveTeamRoomUrl({
            teamRoomUrl: urlSession.teamRoomUrl ?? stored.teamRoomUrl,
        }),
    };
}

export function persistRejoinSession(session: ActiveMatchSession): void {
    writeJson(MATCH_SESSION_KEY, {
        ...session,
        teamRoomUrl: resolveTeamRoomUrl(session),
    });
}

export function saveActiveMatch(session: Omit<ActiveMatchSession, "expiresAt" | "token" | "urls">): void {
    const prev = readJson<ActiveMatchSession>(MATCH_SESSION_KEY);
    // Prefer previously stored in-game identity (uniqueInGameNames / Joined id).
    // joinGame often passes the lobby config name which must not wipe reclaim keys.
    writeJson(MATCH_SESSION_KEY, {
        ...session,
        playerId: session.playerId ?? prev?.playerId,
        playerName: prev?.playerName || session.playerName || "",
        expiresAt: undefined,
        token: undefined,
        urls: undefined,
        teamRoomUrl: resolveTeamRoomUrl(session) ?? prev?.teamRoomUrl,
    });
}

/** Persist Joined player id + exact in-game name for reload reclaim. */
export function touchActiveMatchIdentity(playerId: number, playerName?: string): void {
    const session = readJson<ActiveMatchSession>(MATCH_SESSION_KEY);
    if (!session?.gameId) return;
    session.playerId = playerId;
    if (playerName && playerName.trim()) {
        session.playerName = playerName.trim();
    }
    writeJson(MATCH_SESSION_KEY, session);
}

export function markMatchDisconnected(): ActiveMatchSession | undefined {
    const session = readJson<ActiveMatchSession>(MATCH_SESSION_KEY);
    if (!session?.gameId) return undefined;
    session.expiresAt = Date.now() + MATCH_REJOIN_TTL_MS;
    session.teamRoomUrl = resolveTeamRoomUrl(session);
    writeJson(MATCH_SESSION_KEY, session);
    return session;
}

export function storeRejoinToken(
    matchData: FindGameMatchData,
    region: string,
    gameModeIdx: number,
    playerName: string,
    teamRoomUrl?: string,
): ActiveMatchSession {
    const prev = readJson<ActiveMatchSession>(MATCH_SESSION_KEY);
    const session: ActiveMatchSession = {
        gameId: matchData.gameId,
        region,
        gameModeIdx,
        playerName: playerName || prev?.playerName || "",
        playerId: prev?.playerId,
        teamRoomUrl: resolveTeamRoomUrl({ teamRoomUrl }),
        token: matchData.data,
        urls: matchData.urls,
        expiresAt: Date.now() + MATCH_REJOIN_TTL_MS,
    };
    writeJson(MATCH_SESSION_KEY, session);
    return session;
}

export function clearMatchSession(): void {
    removeKey(MATCH_SESSION_KEY);
}

export function getActiveMatchSession(): ActiveMatchSession | undefined {
    return readJson<ActiveMatchSession>(MATCH_SESSION_KEY);
}

/** Session with a live rejoin window (post-disconnect). */
export function getRejoinSession(): ActiveMatchSession | undefined {
    const session = getActiveMatchSession();
    if (!session?.expiresAt || session.expiresAt <= Date.now()) return undefined;
    return session;
}

/** If the page was reloaded mid-match, start the rejoin window. */
export function ensureRejoinAfterReload(): ActiveMatchSession | undefined {
    const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
    if (nav?.type !== "reload") return getRejoinSession();

    const session = getActiveMatchSession();
    if (!session?.gameId || session.expiresAt) return getRejoinSession();

    return markMatchDisconnected();
}

export function rejoinSecondsLeft(session: ActiveMatchSession): number {
    if (!session.expiresAt) return 0;
    return Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1000));
}

export function buildRejoinUrl(session: ActiveMatchSession, baseUrl?: string): string {
    const url = new URL(baseUrl || window.location.href);
    url.searchParams.set("rejoin", "1");
    url.searchParams.set("gameId", session.gameId);
    url.searchParams.set("region", session.region);
    url.searchParams.set("mode", String(session.gameModeIdx));
    if (session.expiresAt) {
        url.searchParams.set("until", String(session.expiresAt));
    }
    if (session.playerId) {
        url.searchParams.set("pid", String(session.playerId));
    }
    if (session.playerName) {
        url.searchParams.set("pname", session.playerName);
    }
    const teamRoomUrl = resolveTeamRoomUrl(session);
    if (teamRoomUrl) {
        url.searchParams.set("team", teamRoomUrl.replace(/^#/, ""));
    }
    url.hash = "";
    return url.toString();
}

export function parseRejoinFromLocation(
    search = window.location.search,
): ActiveMatchSession | undefined {
    const params = new URLSearchParams(search);
    if (params.get("rejoin") !== "1") return undefined;

    const gameId = params.get("gameId");
    const region = params.get("region");
    const mode = params.get("mode");
    const until = params.get("until");
    if (!gameId || !region || !mode) return undefined;

    const gameModeIdx = Number(mode);
    if (!Number.isFinite(gameModeIdx) || gameModeIdx < 0) return undefined;

    const expiresAt = until ? Number(until) : Date.now() + MATCH_REJOIN_TTL_MS;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return undefined;

    const team = params.get("team");
    const pidRaw = params.get("pid");
    const pid = pidRaw ? Number(pidRaw) : undefined;
    const pname = params.get("pname")?.trim() || "";
    return {
        gameId,
        region,
        gameModeIdx,
        playerName: pname,
        playerId: pid && Number.isFinite(pid) && pid > 0 ? pid : undefined,
        teamRoomUrl: team ? `#${team}` : resolveTeamRoomUrl(),
        expiresAt,
    };
}

export function syncRejoinUrl(session: ActiveMatchSession): void {
    if (!window.history?.replaceState) return;
    const url = buildRejoinUrl(session);
    const parsed = new URL(url);
    window.history.replaceState(
        "",
        document.title,
        `${parsed.pathname}${parsed.search}`,
    );
}

export function clearRejoinUrlParams(): void {
    if (!window.history?.replaceState) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("rejoin");
    url.searchParams.delete("gameId");
    url.searchParams.delete("region");
    url.searchParams.delete("mode");
    url.searchParams.delete("until");
    url.searchParams.delete("team");
    url.searchParams.delete("pid");
    url.searchParams.delete("pname");
    window.history.replaceState("", document.title, `${url.pathname}${url.search}${url.hash}`);
}

export function saveTeamLobbySession(roomUrl: string): void {
    if (!roomUrl) return;
    writeJson(TEAM_LOBBY_KEY, { roomUrl } satisfies TeamLobbySession);
}

export function clearTeamLobbySession(): void {
    removeKey(TEAM_LOBBY_KEY);
}

export function getTeamLobbySession(): TeamLobbySession | undefined {
    const data = readJson<TeamLobbySession>(TEAM_LOBBY_KEY);
    return data?.roomUrl ? data : undefined;
}

export function teamRoomCode(session: ActiveMatchSession): string | undefined {
    return resolveTeamRoomUrl(session)?.replace(/^#/, "");
}

export function isTeamMatchSession(session: ActiveMatchSession): boolean {
    return !!teamRoomCode(session);
}
