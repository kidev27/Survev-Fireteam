import { timingSafeEqual } from "node:crypto";

/** Minimum length for a usable inter-server API key. */
export const MIN_API_KEY_LENGTH = 16;

/**
 * Shared secret check for API ↔ game (and bot) private routes.
 * Empty / short keys never match — both sides must set the same SURVEV_API_KEY.
 */
export function apiKeysMatch(
    provided: string | null | undefined,
    expected: string | null | undefined,
): boolean {
    const want = expected?.trim() ?? "";
    const got = provided?.trim() ?? "";
    if (want.length < MIN_API_KEY_LENGTH || got.length < MIN_API_KEY_LENGTH) {
        return false;
    }
    if (want.length !== got.length) {
        return false;
    }
    try {
        return timingSafeEqual(Buffer.from(want, "utf8"), Buffer.from(got, "utf8"));
    } catch {
        return false;
    }
}

export function isApiKeyConfigured(key: string | null | undefined): boolean {
    return (key?.trim().length ?? 0) >= MIN_API_KEY_LENGTH;
}
