import { util } from "../../utils/util.ts";

/** Optional mid-wave Spec Ops contracts for cash / gear rewards. */
export const SpecOpsContractKinds = [
    "hold_drop",
    "most_wanted",
    "weapon_cash",
] as const;

export type SpecOpsContractKind = (typeof SpecOpsContractKinds)[number];

/** First wave that can offer a contract. */
export const SpecOpsContractStartWave = 4;
/** Seconds after combat starts before a contract can spawn. */
export const SpecOpsContractOfferDelay = 12;
/** Active contract stays available this many waves (including start wave). */
export const SpecOpsContractDurationWaves = 5;
/** Waves to wait after a contract completes or expires before offering another. */
export const SpecOpsContractCooldownWaves = 4;
/** Hold-zone seconds to call in a care package. */
export const SpecOpsContractHoldSeconds = 25;
export const SpecOpsContractHoldRadius = 9;
/** Most-wanted proximity before he engages (meters). */
export const SpecOpsContractWantedProximity = 14;
/** Cash for completing a hold / most-wanted contract (before wave scale). */
export const SpecOpsContractCashBase = 900;
/** Weapons that can roll for the 3× cash contract. */
export const SpecOpsContractWeaponPool = [
    "mp5",
    "mac10",
    "ak47",
    "hk416",
    "m870",
    "mp220",
    "mosin",
    "scar",
    "vector",
    "famas",
    "deagle",
] as const;
export const SpecOpsContractWeaponCashMult = 3;

export function specOpsContractCash(wave: number): number {
    return SpecOpsContractCashBase + Math.max(0, wave) * 55;
}

export function pickSpecOpsContractKind(wave: number): SpecOpsContractKind {
    const pool: SpecOpsContractKind[] = ["hold_drop", "weapon_cash"];
    if (wave >= 5) pool.push("most_wanted");
    return util.randomItem(pool);
}

export function pickSpecOpsContractWeapon(): string {
    return util.randomItem([...SpecOpsContractWeaponPool]);
}

/** Pack contract HUD into a uint16 for Spec Ops active-player sync. */
export function packSpecOpsContractHud(opts: {
    kind?: SpecOpsContractKind;
    /** Hold: 0–100%. Wanted/weapon: unused (waves packed separately). */
    progress?: number;
    weapon?: string;
    /** Waves left including current (1–Duration). */
    wavesLeft?: number;
}): number {
    if (!opts.kind) return 0;
    const kind = SpecOpsContractKinds.indexOf(opts.kind) + 1;
    if (kind <= 0) return 0;
    const progress = Math.min(127, Math.max(0, Math.floor(opts.progress ?? 0)));
    let weaponIdx = 0;
    if (opts.kind === "weapon_cash" && opts.weapon) {
        const i = (SpecOpsContractWeaponPool as readonly string[]).indexOf(opts.weapon);
        weaponIdx = i >= 0 ? Math.min(63, i + 1) : 0;
    } else if (opts.wavesLeft !== undefined) {
        // Reuse weapon bits for waves-left on hold / most-wanted.
        weaponIdx = Math.min(63, Math.max(0, Math.floor(opts.wavesLeft)));
    }
    return kind | (progress << 3) | (weaponIdx << 10);
}

export function formatSpecOpsContractHud(code: number): string {
    if (!code) return "";
    const kindIdx = (code & 7) - 1;
    const kind = SpecOpsContractKinds[kindIdx];
    if (!kind) return "";
    const progress = (code >> 3) & 127;
    const weaponIdx = ((code >> 10) & 63) - 1;
    const wavesPacked = (code >> 10) & 63;
    const wavesSuffix = wavesPacked > 0 ? ` · ${wavesPacked}w` : "";
    if (kind === "hold_drop") {
        return `CONTRACT · Hold zone ${progress}%${wavesSuffix}`;
    }
    if (kind === "most_wanted") {
        return `CONTRACT · Eliminate Most Wanted${wavesSuffix}`;
    }
    if (kind === "weapon_cash") {
        const weapon = SpecOpsContractWeaponPool[weaponIdx] ?? "weapon";
        return `CONTRACT · Use ${weapon.toUpperCase()} · ${SpecOpsContractWeaponCashMult}× cash`;
    }
    return "CONTRACT";
}
