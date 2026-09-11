import { createHmac, timingSafeEqual } from "node:crypto";
import type { FindGamePrivateBody } from "./types.ts";

/** Short-lived ticket so clients (or team lobby) can find_game on a child without the master proxying. */
export type FindGameSessionTicket = {
    v: 1;
    exp: number;
    region: string;
    findGame: FindGamePrivateBody;
};

const TICKET_TTL_MS = 30_000;

function b64url(buf: Buffer): string {
    return buf.toString("base64url");
}

function hmac(secret: string, payload: string): Buffer {
    return createHmac("sha256", secret).update(payload).digest();
}

export function signFindGameTicket(
    region: string,
    findGame: FindGamePrivateBody,
    secret: string,
    ttlMs = TICKET_TTL_MS,
): string {
    const body: FindGameSessionTicket = {
        v: 1,
        exp: Date.now() + ttlMs,
        region,
        findGame,
    };
    const payload = b64url(Buffer.from(JSON.stringify(body), "utf8"));
    const sig = b64url(hmac(secret, payload));
    return `${payload}.${sig}`;
}

export function verifyFindGameTicket(
    ticket: string,
    secret: string,
): FindGameSessionTicket | null {
    const want = secret?.trim() ?? "";
    if (want.length < 16 || !ticket || !ticket.includes(".")) return null;

    const dot = ticket.lastIndexOf(".");
    const payload = ticket.slice(0, dot);
    const sig = ticket.slice(dot + 1);
    if (!payload || !sig) return null;

    let expected: Buffer;
    let got: Buffer;
    try {
        expected = hmac(want, payload);
        got = Buffer.from(sig, "base64url");
    } catch {
        return null;
    }
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
        return null;
    }

    try {
        const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as FindGameSessionTicket;
        if (json?.v !== 1 || typeof json.exp !== "number" || !json.findGame) {
            return null;
        }
        if (Date.now() > json.exp) return null;
        return json;
    } catch {
        return null;
    }
}

/** Player-facing URL for completing matchmaking on a region host. */
export function buildSessionFindGameUrl(opts: {
    url?: string;
    publicAddress?: string;
    address?: string;
    https?: boolean;
}): string | undefined {
    const fromUrl = opts.url?.trim();
    if (fromUrl) {
        try {
            const u = new URL(fromUrl.includes("://") ? fromUrl : `http://${fromUrl}`);
            return `${u.protocol}//${u.host}/session/find_game`;
        } catch {
            // fall through
        }
    }

    const host = (opts.publicAddress || opts.address || "").trim()
        .replace(/^https?:\/\//i, "")
        .replace(/\/+$/, "");
    if (!host) return undefined;

    // Prefer https when flagged; plain http for raw host:port (dev / LAN).
    const https = opts.https ?? (!/:\d+$/.test(host) && !/^(\d{1,3}\.){3}\d{1,3}/.test(host));
    return `${https ? "https" : "http"}://${host}/session/find_game`;
}

/**
 * Master → game-manager session URL. Always use the matchmaking `address`
 * (never the player-facing `url`), so a live CDN URL in config cannot redirect
 * team find_game onto production while developing locally.
 */
export function buildInternalSessionFindGameUrl(address?: string): string | undefined {
    const host = (address || "").trim()
        .replace(/^https?:\/\//i, "")
        .replace(/\/+$/, "");
    if (!host) return undefined;
    return `http://${host}/session/find_game`;
}
