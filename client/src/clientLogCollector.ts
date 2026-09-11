import { api } from "./api.ts";

type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

interface QueuedLog {
    ts: string;
    level: ConsoleLevel | "windowOnError" | "errorLog";
    message: string;
    data?: unknown;
}

const MAX_QUEUE = 200;
const FLUSH_MS = 4_000;
const MAX_BATCH = 40;
const MAX_ARG_LEN = 2_000;

let installed = false;
let sessionId = "";
let queue: QueuedLog[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function truncate(s: string): string {
    if (s.length <= MAX_ARG_LEN) return s;
    return `${s.slice(0, MAX_ARG_LEN)}…`;
}

function serializeArg(arg: unknown): string {
    if (arg instanceof Error) {
        return truncate(`${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ""}`);
    }
    if (typeof arg === "string") return truncate(arg);
    if (typeof arg === "number" || typeof arg === "boolean" || arg == null) {
        return String(arg);
    }
    try {
        return truncate(JSON.stringify(arg));
    } catch {
        return truncate(Object.prototype.toString.call(arg));
    }
}

function enqueue(entry: QueuedLog) {
    queue.push(entry);
    if (queue.length > MAX_QUEUE) {
        queue.splice(0, queue.length - MAX_QUEUE);
    }
    scheduleFlush();
}

function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        void flush();
    }, FLUSH_MS);
}

async function flush() {
    if (flushing || !queue.length) return;
    flushing = true;
    const batch = queue.splice(0, MAX_BATCH);
    try {
        await fetch(api.resolveUrl("/api/client_logs"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId: sessionId || undefined,
                href: typeof location !== "undefined" ? location.href : undefined,
                userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
                entries: batch,
            }),
            keepalive: true,
        });
    } catch {
        // Put failed batch back (best effort) without growing forever.
        queue = [...batch, ...queue].slice(-MAX_QUEUE);
    } finally {
        flushing = false;
        if (queue.length) scheduleFlush();
    }
}

/** Capture console.* and ship batches to the API for production file logs. */
export function installClientLogCollector(opts?: { sessionId?: string }) {
    if (installed || typeof console === "undefined") return;
    installed = true;
    if (opts?.sessionId) sessionId = opts.sessionId;

    const levels: ConsoleLevel[] = ["log", "info", "warn", "error", "debug"];
    for (const level of levels) {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            original(...args);
            enqueue({
                ts: new Date().toISOString(),
                level,
                message: args.map(serializeArg).join(" "),
            });
        };
    }

    window.addEventListener("pagehide", () => {
        void flush();
    });
    window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") void flush();
    });
}

export function setClientLogSessionId(id: string) {
    sessionId = id;
}

/** Queue a structured client error (also mirrored via /api/report_error). */
export function queueClientErrorLog(
    level: "windowOnError" | "errorLog",
    message: string,
    data?: unknown,
) {
    enqueue({
        ts: new Date().toISOString(),
        level,
        message,
        data,
    });
}

export function flushClientLogsNow() {
    return flush();
}
