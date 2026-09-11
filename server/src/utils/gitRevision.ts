import { execSync } from "node:child_process";

export let GIT_VERSION = process.env.SURVEV_GIT_REV?.trim() || "Unknown";
if (GIT_VERSION === "Unknown") {
    try {
        GIT_VERSION = execSync("git rev-parse HEAD", {
            stdio: ["ignore", "pipe", "ignore"],
        }).toString().trim();
    } catch {
        // Minimal deploys often omit git; version string stays "Unknown".
    }
}
