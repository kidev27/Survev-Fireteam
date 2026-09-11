import { isIP } from "node:net";

/** First valid IPv4/IPv6 from a proxy header that may be a comma-separated list. */
export function firstValidIp(raw: string | null | undefined): string | undefined {
    if (!raw) return undefined;
    for (const part of raw.split(",")) {
        let ip = part.trim();
        if (!ip) continue;
        if (ip.startsWith("::ffff:")) {
            ip = ip.slice("::ffff:".length);
        }
        if (isIP(ip) !== 0) return ip;
    }
    return undefined;
}

/** Client IP from a proxied HTTP request and Bun's remote address. */
export function resolveClientIp(
    req: Request,
    remoteAddress: string | undefined,
    proxyHeader?: string,
): string | undefined {
    if (proxyHeader) {
        const fromHeader = firstValidIp(req.headers.get(proxyHeader));
        if (fromHeader) return fromHeader;
        // Common fallback when only X-Forwarded-For is set.
        if (proxyHeader !== "X-Forwarded-For") {
            const fromXff = firstValidIp(req.headers.get("X-Forwarded-For"));
            if (fromXff) return fromXff;
        }
    }
    return firstValidIp(remoteAddress?.replace(/^::ffff:/, "") ?? "");
}
