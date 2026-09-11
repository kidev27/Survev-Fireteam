import type { MapDefKey } from "./shared/defs/mapDefs.ts";
import type { SpecOpsDifficulty } from "./shared/defs/maps/specOpsShop.ts";
import type { TeamMode } from "./shared/gameConfig.ts";
import type { ProxyDef } from "./shared/types/api.ts";
import type { DeepPartial } from "./shared/utils/util.ts";
import type { Vec2 } from "./shared/utils/v2.ts";

/**
 * Common keys used by both API and game server.
 */
interface ServerConfig {
    /**
     * Run this service on this host. false = skip at start.
     * Prefer setting via top-level `api.enabled` / `game.enabled` in hjson.
     * @default true
     */
    enabled: boolean;

    host: string;
    port: number;

    /**
     * HTTP Header used to get IP addresses.
     *
     * NOTE: Only use this when running the specified server under a proxy.
     * Setting a proxy IP header and exposing a direct (without a proxy) connection to the server allows attackers to spoof their IP with the header!
     *
     * A commonly used value is "X-Real-IP"
     */
    proxyIPHeader?: string;

    /**
     * SSL file paths. Not needed if behind an HTTPS proxy.
     */
    ssl?: {
        keyFile: string;
        certFile: string;
    };
}

export type ServerMode = "dev" | "live";

/**
 * Derived from api/game/client `.enabled` flags (or legacy `role`).
 * Prefer `api.enabled` / `game.enabled` / `client.enabled` in survev-config.hjson.
 */
export type InstanceRole =
    | "all"
    | "api"
    | "game"
    | "frontend"
    | "api+game"
    | "api+frontend"
    | "game+frontend";

export type DatabaseEngine = "postgres" | "sqlite" | "mariadb" | "mongodb";

/** Compact `modes: { solo, duo, squad }` in survev-config.hjson. Expanded to the array at load. */
export type CompactGameModes = {
    solo?: boolean;
    duo?: boolean;
    squad?: boolean;
};

export interface ConfigType {
    /**
     * "dev"  = debug on, bind 0.0.0.0, rate limits off
     * "live" = debug off, bind 127.0.0.1 if omitted, rate limits on if omitted
     */
    serverMode: ServerMode;

    /**
     * Derived from api/game/client enabled flags. Prefer those over setting this.
     * Legacy hjson alias: `role`.
     * @default "all"
     */
    instanceRole: InstanceRole;

    /**
     * Public or private URL of the API server.
     * Required when this host does not run the API (`api.enabled: false`).
     * Sets gameServer.apiServerUrl when that field is empty.
     * Alias in hjson: `apiUrl` or `game.apiUrl`.
     *
     * Examples: "http://10.0.0.5:8000", "https://api.example.com"
     */
    apiUrl?: string;

    /**
     * Optional absolute API base for the browser client when the frontend is
     * not same-origin with the API (split frontend host). Empty = relative /api.
     * Example: "https://api.example.com"
     */
    apiPublicUrl?: string;

    /**
     * Listen host for API, game, and vite. Live does not override this when set.
     * Omit on live to default to 127.0.0.1. Clients use advertiseHost / publicAddress.
     */
    bind: string;

    /**
     * Host advertised to clients (LAN/WAN IP or domain). Empty/omit = auto-detect.
     * Separate from `bind` (what the process listens on).
     */
    advertiseHost?: string;

    /**
     * Optional cap on players per match for non-Spec-Ops maps. 0 / unset = map default.
     * Spec Ops uses maxSquadSize.
     */
    maxPlayersPerGame?: number;

    /**
     * Default map for compact `modes: { solo, duo, squad }`.
     */
    mapName?: MapDefKey;

    /**
     * API server configuration.
     * In hjson prefer the compact `api: { enabled, port, … }` section.
     */
    apiServer: ServerConfig;

    /**
     * Game server configuration.
     * In hjson prefer the compact `game: { enabled, port, … }` section.
     */
    gameServer: ServerConfig & {
        /**
         * The full URL of the main API server.
         * Used by the game server to send data like player count and saving match history to the database.
         */
        apiServerUrl: string;

        /**
         * Which region this game server represents.
         * Should be a valid key from the `regions` object.
         */
        thisRegion: string;

        /**
         * First port used by games, each game gets its own port.
         *
         * The last port will be `firstGamePort` + `maxGames`.
         */
        firstGamePort: number;

        /**
         * Maximum amount of games the server can run.
         */
        maxGames: number;
    };

    /**
     * Client / website. In hjson prefer `client: { enabled, port }`.
     */
    vite: {
        enabled: boolean;
        host: string;
        port: number;
    };

    /**
     * Built from this host's `game.id` / `name` / `url` / `address`.
     * One config file = one game identity. Other nodes register via handshake.
     *
     * Prefer flat fields in hjson:
     * ```hjson
     * game: {
     *   id: "main"
     *   name: "Fireteam"
     *   url: "https://fireteam.example.com"
     *   address: "127.0.0.1:8001"
     * }
     * ```
     */
    regions: Record<
        string,
        {
            /**
             * Display name in the Server dropdown (e.g. "US East", "Fireteam").
             * Preferred over translating `l10n`.
             */
            name?: string;
            /**
             * Client-facing endpoint. Accepts:
             * - `https://game.example.com` / `https://game.example.com:443`
             * - `http://192.168.1.10:8001` (LAN)
             * - `203.0.113.10:8001` or `game.example.com` (bare host[:port])
             *
             * Sets `https` + `publicAddress` when present.
             */
            url?: string;
            https: boolean;
            /**
             * Host:port the API uses to reach the game manager (prefer loopback).
             * Protocols (`http://`) are stripped. Default: `127.0.0.1:<gamePort>`.
             */
            address: string;
            /**
             * Host[:port] advertised to clients for pings / joins when `url` is unset.
             * Protocols are stripped. Falls back to `address`.
             */
            publicAddress?: string;
            /**
             * Optional translation key when `name` is omitted (e.g. "index-local").
             */
            l10n?: string;
        }
    >;

    proxies: Record<string, ProxyDef>;

    /**
     * Enabled game modes (Solo / Duo / Squad). The hjson file also accepts
     * `modes: { solo: true, duo: true, squad: false }` — expanded to this array at load.
     *
     * Defaults to Solo, Duo and Squad, all enabled and on "specops".
     * NOTE: The client UI currently only supports a maximum of 3 modes.
     */
    modes: Array<{
        /**
         * The ID of the map this mode will be running
         */
        mapName: MapDefKey;
        /**
         * The team mode: 1 Solo, 2 Duo, 4 Squad
         */
        teamMode: TeamMode;
        /**
         * Enables / disables the mode, will apply a "disabled" effect to the button client-side
         */
        enabled: boolean;
    }>;

    /**
     * How many players can be in a Squad lobby / Spec Ops group.
     * Duo stays 2. Solo stays 1. Clamped to 2–8 (HUD has 8 teammate bars).
     * @default 4
     */
    maxSquadSize: number;

    /**
     * Spec Ops difficulty for solo/quick-play and new lobby defaults.
     * recruit | regular | hardened | veteran
     * @default "regular"
     */
    difficulty: SpecOpsDifficulty;

    /**
     * Spec Ops continuous waves: when a wave is cleared the next wave starts
     * immediately (no shop / intermission timer). Missions never auto-win at wave 30.
     * Opening prep and the wave-29 glory truce still use their timers.
     * @default false
     */
    endless: boolean;

    /**
     * Mid-wave Spec Ops contracts (hold zone, Most Wanted, disk upload, weapon cash).
     * @default true
     */
    contractsEnabled: boolean;

    /**
     * The client theme, changes the splash screen background and for some the menu music.
     *
     * NOTE: Required at build time, unlike modes it wont update by fetching from the server!
     */
    clientTheme: MapDefKey;

    /**
     * The battle pass, set to an empty string to disable it
     */
    passType: string;

    /**
     * Game tick rate.
     * Controls how many physics and logic ticks the game will try to process every second, defaults to 100.
     */
    gameTps: number;
    /**
     * "Net Synchronization" tick rate.
     * Controls how frequently the game will try sending updates to clients, defaults to 33.
     *
     * Updates done in the game tick will accumulate to be sent on the next net sync tick.
     */
    netSyncTps: number;

    /**
     * Server logger configuration
     */
    logging: {
        /**
         * If the logger class should include the date.
         * Useful to disable it when using logging tools that add a date by default (like journalctl)
         */
        logDate: boolean;

        // logging categories enabled

        /**
         * Information logs
         */
        infoLogs: boolean;

        /**
         * Debug logs, disabled by default on production
         */
        debugLogs: boolean;

        /**
         * Warning logs
         */
        warnLogs: boolean;

        /**
         * Error logs, will also log to a webhook if `errorLoggingWebhook` is set.
         */
        errorLogs: boolean;

        /**
         * Persist browser console / client error reports under this directory
         * (JSONL files). Relative paths are from the process cwd. Default: logs/client
         */
        clientLogDir?: string;

        /**
         * When false, skip writing client log files (webhooks still work).
         * @default true
         */
        clientLogs?: boolean;
    };
    /**
     * Webhook URL to log server errors.
     */
    errorLoggingWebhook?: string;

    /**
     * Webhook URL to log client errors.
     */
    clientErrorLoggingWebhook?: string;

    /**
     * Database. Hjson uses per-engine blocks; runtime is flattened.
     *
     * ```hjson
     * database: {
     *   engine: "sqlite"   // default — local leaderboard only
     *   sqlite: { path: "data/specops-local.db" }
     *   postgres: { host, port, name, user, password }
     *   mariadb: { host, port, name, user, password }
     *   mongodb: { host, port, name, uri? }
     * }
     * ```
     * `engine: postgres|mariadb|mongodb` enables accounts/stats.
     */
    database: {
        /**
         * Accounts/stats on when engine is postgres|mariadb|mongodb.
         * Derived from `engine` when omitted.
         */
        enabled: boolean;

        /** @default "sqlite" */
        engine: DatabaseEngine;

        /** @default "127.0.0.1" */
        host: string;
        /** @default "survev" */
        user: string;
        /** @default "survev" */
        password: string;
        /** @default "survev" — compact hjson uses `name` inside each engine block */
        database: string;
        /** Port for the active engine */
        port: number;
        /** @default "data/specops-local.db" */
        sqlitePath: string;
        /** Optional mongodb connection URI (overrides host/port when set). */
        uri?: string;
    };

    /**
     * Used for account oauth2 redirects (https://www.oauth.com/oauth2-servers/redirect-uris/).
     * Should be the full hosted website url, example: https://mycoolsurvevserver.io.
     */
    oauthRedirectURI: string;

    /**
     * Base path of the client
     * Used if the API is on a subdomain instead of the main one
     * So the auth code can redirect to it instead of `/`
     */
    oauthBasePath: string;

    /**
     * API keys for accounts and other features.
     */
    secrets: {
        /**
         * Shared secret for API ↔ game server handshake.
         * Required on every host (min 16 chars). Remote game servers with the wrong
         * or missing key are rejected and will not link to the main API.
         * A random key is generated when the config file is first created.
         */
        SURVEV_API_KEY: string;

        /**
         * Used to encode IP addresses on the database
         */
        SURVEV_IP_SECRET: string;

        /**
         * Discord client ID.
         * If this and the secret ID are present the discord login button will be enabled client-side.
         */
        DISCORD_CLIENT_ID?: string;

        /**
         * Discord secret ID.
         * If this and the client ID are present the discord login button will be enabled client-side.
         */
        DISCORD_SECRET_ID?: string;

        /**
         * Google client ID.
         * If this and the secret ID are present the google login button will be enabled client-side.
         */
        GOOGLE_CLIENT_ID?: string;
        /**
         * Google secret ID.
         * If this and the client ID are present the google login button will be enabled client-side.
         */
        GOOGLE_SECRET_ID?: string;

        /**
         * Discord bot token.
         */
        DISCORD_BOT_TOKEN?: string;

        /**
         * Enables proxycheck.io to ban VPNs and proxies from connecting.
         */
        PROXYCHECK_KEY?: string;

        /**
         * Turnstile captcha secret key.
         */
        TURNSTILE_SECRET_KEY?: string;

        /**
         * Turnstile captcha site key.
         */
        TURNSTILE_SITE_KEY?: string;
        /**
         * CrazyGames and GameMonetize ad IDs.
         */
        AD_PREFIX?: string;
        GAMEMONETIZE_ID?: string;

        /**
         * SpellSync project ID and public token.
         * Used for the SpellSync integration.
         */
        SPELLSYNC_PROJECT_ID?: string;
        SPELLSYNC_PUBLIC_TOKEN?: string;
    };

    /**
     * Role ID for users with moderation permissions
     */
    discordRoleId?: string;

    /**
     * Guild ID
     */
    discordGuildId?: string;

    /**
     * Enables caching some expensive API requests (like leaderboards) with Redis.
     *
     * This requires a Redis server to be set up with the API server.
     */
    cachingEnabled: boolean;

    /**
     * If the turnstile captcha state is enabled.
     * Used by the API server and will be returned on site_info API.
     *
     * Requires the turnstile keys on secrets object.
     */
    captchaEnabled: boolean;

    /**
     * Enables IP rate limits.
     * This both limits how many requests per second IP's can make to the API server and how many simultaneous IP's can connect to the game server.
     *
     * Enabled by default on production.
     */
    rateLimitsEnabled: boolean;

    /**
     * If in-game names should be unique.
     * Useful for banning players.
     */
    uniqueInGameNames: boolean;

    /**
     * Debugging config for development :)
     * All the boolean ones default to false on production and true otherwise.
     */
    debug: {
        /**
         * Master switch. If false, allowBots / allowEditMsg / allowMockAccount / allowNpcSpawn
         * are forced off. Set false for a public server.
         * Live serverMode defaults this off unless you explicitly set enabled: true.
         */
        enabled: boolean;
        /**
         * If should use the map default spawn mode or a fixed one
         */
        spawnMode: "default" | "fixed";
        /**
         * Fixed spawn mode position, if not set will use the map center
         */
        spawnPos?: Vec2;
        /**
         * If clients that tag themselves as bots can join
         * This is used for the stress test bots so they get no custom loadout
         */
        allowBots: boolean;
        /**
         * If clients can send edit msgs from the client-side debug editor
         */
        allowEditMsg: boolean;
        /**
         * If the "mock" test account is enabled, used for testing account features without requiring discord or google oauth2 keys
         */
        allowMockAccount: boolean;
        /**
         * Enables the in-game Spec Ops NPC spawn panel (editor Players tab).
         * Requires allowEditMsg on the server; never exposed to normal players.
         */
        allowNpcSpawn: boolean;
    };

    /**
     * Overrides default items players spawn with, mostly for development.
     * Account loadouts and mode spawn items (eg from cobalt) can still override this!
     */
    defaultItems: {
        weapons?: [
            {
                type: string;
                ammo: number;
            },
        ];
        outfit?: string;
        backpack?: string;
        helmet?: string;
        chest?: string;
        scope?: string;
        perks?: Array<{ type: string; droppable?: boolean }>;
        /**
         * ammo, grenades, healing items and scopes
         */
        inventory?: Record<string, number>;
    };
}

export type PartialConfig = DeepPartial<ConfigType>;
