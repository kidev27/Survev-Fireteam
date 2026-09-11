import { proxy } from "./proxy.ts";

export const api = {
    resolveUrl(url: string) {
        const publicApi = typeof API_PUBLIC_URL === "string" ? API_PUBLIC_URL.trim() : "";
        if (publicApi) {
            return publicApi.replace(/\/$/, "") + url;
        }
        // Production serves API through the same host (prod-web / nginx).
        if (!IS_DEV) return url;
        const proxyDef = proxy.getProxyDef();
        if (proxyDef && proxyDef.def.apiUrl) {
            return proxyDef.def.apiUrl + url;
        }
        return url;
    },
    resolveRoomHost() {
        const proxyDef = proxy.getProxyDef();
        if (proxyDef && proxyDef.def.apiUrl) {
            return new URL(proxyDef.def.apiUrl).host;
        }
        return window.location.host;
    },
    /**
     * Team lobby WS. One URL only — never try loopback and same-origin together.
     * A LAN page (192.168.x / public IP) must stay on `host/team_v2` (wan-proxy).
     * Opening 127.0.0.1:8000 from that page races: the loopback attempt fails or
     * hits the wrong machine, then reconnect flaps the seat every ~1s.
     */
    resolveTeamWsUrls(): string[] {
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.hostname;
        const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]"
            || host === "::1";
        if (IS_DEV && loopback) {
            return [`${proto}//127.0.0.1:8000/team_v2`];
        }
        return [`${proto}//${window.location.host}/team_v2`];
    },
    resolveTeamWsUrl(): string {
        return this.resolveTeamWsUrls()[0]!;
    },
    /** Ping WS — prefer each region's public host so multi-region works over the web. */
    resolvePingWsUrls(https: boolean, regionHost?: string): string[] {
        const pageProto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const sameOrigin = `${pageProto}//${window.location.host}/ptc`;

        // Vite / wan-proxy: never probe production public hosts — session + ping stay local.
        if (IS_DEV) {
            const out = [sameOrigin];
            const host = window.location.hostname;
            if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
                out.push("ws://127.0.0.1:8001/ptc");
            }
            return out;
        }

        const out: string[] = [];
        const seen = new Set<string>();
        const push = (u: string) => {
            if (!seen.has(u)) {
                seen.add(u);
                out.push(u);
            }
        };

        if (regionHost) {
            const host = regionHost
                .replace(/^https?:\/\//i, "")
                .replace(/\/+$/, "")
                .replace(/\/ptc$/i, "");
            if (host) {
                // Use page protocol when region is same-site https fronted; else honor region flag.
                const pageIsHttps = window.location.protocol === "https:";
                const proto = https || pageIsHttps ? "wss:" : "ws:";
                push(`${proto}//${host}/ptc`);
            }
        }

        push(sameOrigin);
        return out;
    },
    resolvePingWsUrl(https: boolean): string {
        return this.resolvePingWsUrls(https)[0]!;
    },
    /**
     * Prefer same-origin /session when the ticket URL points at loopback or this
     * page host (colocated master). Remote children keep their absolute findUrl.
     * In Vite DEV, always stay on this origin (config often still has a live `game.url`).
     */
    resolveSessionFindUrl(findUrl: string): string {
        if (IS_DEV) {
            return `${window.location.origin}/session/find_game`;
        }
        try {
            const u = new URL(findUrl);
            const pageHost = window.location.hostname;
            const loopback = (h: string) => h === "127.0.0.1" || h === "localhost" || h === "::1";
            if (loopback(u.hostname) && !loopback(pageHost)) {
                return `${window.location.origin}/session/find_game`;
            }
            if (u.hostname === pageHost || (loopback(u.hostname) && loopback(pageHost))) {
                return `${window.location.origin}/session/find_game`;
            }
            return findUrl;
        } catch {
            return findUrl;
        }
    },
    /**
     * Prefer joining on the region host that issued the match URLs.
     * Never rewrite a child match onto the master page host — that was binding
     * every session through the master and lagging when a child was down.
     * Vite DEV always tunnels via the page (wan-proxy) — `game.url` often still
     * points at the live CDN while matches run on localhost.
     */
    resolveGameWsUrls(urls: string[]): string[] {
        const out: string[] = [];
        const seen = new Set<string>();
        const push = (u: string) => {
            if (!seen.has(u)) {
                seen.add(u);
                out.push(u);
            }
        };

        const pageProto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const pageHost = window.location.hostname;
        const onLocalhost = pageHost === "localhost" || pageHost === "127.0.0.1"
            || pageHost === "[::1]" || pageHost === "::1";
        const pagePort = window.location.port
            || (window.location.protocol === "https:" ? "443" : "80");

        const hostsEqual = (a: string, b: string) => {
            const norm = (h: string) => h.replace(/^\[|\]$/g, "").toLowerCase();
            return norm(a) === norm(b);
        };

        const tunnelViaPage = (url: string) => {
            const parsed = new URL(url);
            const pathPort = /^\/g\/(\d+)(?=\/|$)/.exec(parsed.pathname)?.[1];
            const gamePort = pathPort ?? parsed.port
                ?? (parsed.protocol === "wss:" || parsed.protocol === "https:" ? "443" : "80");
            const viaSite = new URL(url);
            viaSite.protocol = pageProto;
            viaSite.hostname = window.location.hostname;
            viaSite.port = window.location.port;
            if (!pathPort) {
                const rest = parsed.pathname === "/" ? "/play" : parsed.pathname;
                viaSite.pathname = `/g/${gamePort}${rest}`;
            }
            return viaSite.toString();
        };

        if (IS_DEV) {
            for (const url of urls) {
                try {
                    push(tunnelViaPage(url));
                    const parsed = new URL(url);
                    const pathPort = /^\/g\/(\d+)(?=\/|$)/.exec(parsed.pathname)?.[1];
                    const gamePort = pathPort ?? parsed.port
                        ?? (parsed.protocol === "wss:" || parsed.protocol === "https:" ? "443" : "80");
                    if (onLocalhost && String(gamePort) !== pagePort) {
                        const loopback = new URL(url);
                        loopback.protocol = pageProto;
                        loopback.hostname = "127.0.0.1";
                        loopback.port = gamePort;
                        if (pathPort) {
                            loopback.pathname = parsed.pathname.replace(/^\/g\/\d+/, "") || "/play";
                        }
                        push(loopback.toString());
                    }
                } catch {
                    push(url);
                }
            }
            return out;
        }

        for (const url of urls) {
            try {
                const parsed = new URL(url);
                const pathPort = /^\/g\/(\d+)(?=\/|$)/.exec(parsed.pathname)?.[1];
                const gamePort = pathPort ?? parsed.port
                    ?? (parsed.protocol === "wss:" ? "443" : "80");
                const sameHost = hostsEqual(parsed.hostname, pageHost)
                    || (onLocalhost
                        && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost"));

                if (sameHost) {
                    push(tunnelViaPage(url));
                } else {
                    // Remote child — join that host directly (Plutonium-style).
                    const direct = new URL(url);
                    if (window.location.protocol === "https:") {
                        direct.protocol = "wss:";
                    }
                    push(direct.toString());
                }
            } catch {
                push(url);
            }
        }
        return out;
    },
};
