export type ClientServerInfo = {
    https: boolean;
    address: string;
    l10n: string;
    name?: string;
};

/** Live Server dropdown registry — seeded from build, refreshed from site_info pops. */
export const serverRegistry: Record<string, ClientServerInfo> = Object.fromEntries(
    Object.entries(GAME_REGIONS).map(([id, data]) => [
        id,
        {
            https: data.https,
            address: data.address,
            l10n: data.l10n || "",
            name: data.name,
        },
    ]),
);

/** First configured server id, or empty if none. */
export function defaultServerId(): string {
    return Object.keys(serverRegistry)[0] || "";
}

/** Resolve a stored/selected region to a known live server key. */
export function resolveServerId(preferred?: string | null): string {
    const keys = Object.keys(serverRegistry);
    if (!keys.length) return "";
    if (preferred && preferred in serverRegistry) return preferred;
    return keys[0]!;
}
