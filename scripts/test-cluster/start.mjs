/**
 * Start master API + 3 child game nodes for local multi-region testing.
 * Usage: bun scripts/test-cluster/start.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cluster = path.join(root, "scripts/test-cluster");
const logDir = path.join(cluster, "logs");
mkdirSync(logDir, { recursive: true });

const bun = process.platform === "win32" ? "bun.exe" : "bun";
const children = [];
let shuttingDown = false;

function start(name, configDir, script) {
    const env = {
        ...process.env,
        SURVEV_CONFIG_DIR: path.join(cluster, configDir),
        NODE_ENV: "production",
    };
    const child = spawn(bun, [script], {
        cwd: root,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });
    children.push({ name, child });

    const prefix = `[${name}] `;
    const onData = (buf) => {
        const text = buf.toString();
        for (const line of text.split(/\r?\n/)) {
            if (line) console.log(prefix + line);
        }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code, signal) => {
        console.error(`${prefix}exited code=${code} signal=${signal}`);
        if (!shuttingDown) stopAll();
    });
    return child;
}

function stopAll() {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const { child } of children) {
        try {
            child.kill("SIGTERM");
        } catch {
            // ignore
        }
    }
    setTimeout(() => process.exit(0), 500).unref?.();
}

start("master", "master", "server/src/api/index.ts");
start("ft1", "ft1", "server/src/gameServer.ts");
start("ft2", "ft2", "server/src/gameServer.ts");
start("ft3", "ft3", "server/src/gameServer.ts");

console.log("Cluster starting: master + ft1 + ft2 + ft3");
console.log("Ctrl+C to stop.");

for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, stopAll);
}
