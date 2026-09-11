import { math } from "../../shared/utils/math.ts";
import { v2, type Vec2 } from "../../shared/utils/v2.ts";

/** Standard W3C gamepad layout (Xbox / PlayStation / Switch / Steam in most browsers). */
const DEADZONE = 0.18;
const TRIGGER_THRESHOLD = 0.35;

export interface GamepadState {
    active: boolean;
    moveX: number;
    moveY: number;
    aimDir: Vec2;
    aimLen: number;
    fire: boolean;
    firePressed: boolean;
    reload: boolean;
    reloadPressed: boolean;
    interact: boolean;
    interactPressed: boolean;
    cancel: boolean;
    cancelPressed: boolean;
    nextWeap: boolean;
    prevWeap: boolean;
    map: boolean;
    mapPressed: boolean;
    emote: boolean;
    emotePressed: boolean;
    confirm: boolean;
    confirmPressed: boolean;
    back: boolean;
    backPressed: boolean;
    menuUp: boolean;
    menuUpPressed: boolean;
    menuDown: boolean;
    menuDownPressed: boolean;
    menuLeft: boolean;
    menuLeftPressed: boolean;
    menuRight: boolean;
    menuRightPressed: boolean;
    menuTabPrevPressed: boolean;
    menuTabNextPressed: boolean;
}

function applyDeadzone(v: number): number {
    const a = Math.abs(v);
    if (a < DEADZONE) return 0;
    return Math.sign(v) * ((a - DEADZONE) / (1 - DEADZONE));
}

function btn(gp: Gamepad, idx: number): boolean {
    return !!gp.buttons[idx]?.pressed;
}

function trigger(gp: Gamepad, btnIdx: number, axisIdx: number): boolean {
    if (btn(gp, btnIdx)) return true;
    const axis = gp.axes[axisIdx] ?? 0;
    return axis > TRIGGER_THRESHOLD;
}

function btnPressed(gp: Gamepad, idx: number, prev: boolean): boolean {
    const down = btn(gp, idx);
    return down && !prev;
}

function triggerPressed(
    gp: Gamepad,
    btnIdx: number,
    axisIdx: number,
    prevBtn: boolean,
    prevAxis: boolean,
): boolean {
    const down = trigger(gp, btnIdx, axisIdx);
    const axisDown = (gp.axes[axisIdx] ?? 0) > TRIGGER_THRESHOLD;
    return down && !(prevBtn || prevAxis);
}

function dpadMove(gp: Gamepad): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (btn(gp, 14)) x -= 1;
    if (btn(gp, 15)) x += 1;
    if (btn(gp, 12)) y += 1;
    if (btn(gp, 13)) y -= 1;
    return { x, y };
}

let wakeupInstalled = false;

/** Browsers only expose gamepad state after a user gesture; prime polling on Deck/desktop. */
export function ensureGamepadWakeup() {
    if (wakeupInstalled || !navigator.getGamepads) return;
    wakeupInstalled = true;
    const prime = () => {
        navigator.getGamepads();
    };
    window.addEventListener("gamepadconnected", prime);
    window.addEventListener("mousedown", prime, { once: true });
    window.addEventListener("touchstart", prime, { once: true });
    window.addEventListener("keydown", prime, { once: true });
}

export class GamepadHandler {
    private index = -1;
    private prevButtons: boolean[] = [];
    private prevRtAxis = false;
    private prevLtAxis = false;
    private prevMenuUp = false;
    private prevMenuDown = false;
    private prevMenuLeft = false;
    private prevMenuRight = false;

    poll(): GamepadState {
        const empty: GamepadState = {
            active: false,
            moveX: 0,
            moveY: 0,
            aimDir: v2.create(1, 0),
            aimLen: 0,
            fire: false,
            firePressed: false,
            reload: false,
            reloadPressed: false,
            interact: false,
            interactPressed: false,
            cancel: false,
            cancelPressed: false,
            nextWeap: false,
            prevWeap: false,
            map: false,
            mapPressed: false,
            emote: false,
            emotePressed: false,
            confirm: false,
            confirmPressed: false,
            back: false,
            backPressed: false,
            menuUp: false,
            menuUpPressed: false,
            menuDown: false,
            menuDownPressed: false,
            menuLeft: false,
            menuLeftPressed: false,
            menuRight: false,
            menuRightPressed: false,
            menuTabPrevPressed: false,
            menuTabNextPressed: false,
        };

        if (!navigator.getGamepads) return empty;

        const pads = navigator.getGamepads();
        let gp: Gamepad | null = null;

        if (this.index >= 0 && pads[this.index]?.connected) {
            gp = pads[this.index];
        } else {
            for (let i = 0; i < pads.length; i++) {
                if (pads[i]?.connected) {
                    this.index = i;
                    gp = pads[i];
                    break;
                }
            }
        }

        if (!gp) {
            this.index = -1;
            return empty;
        }

        const lx = applyDeadzone(gp.axes[0] ?? 0);
        const ly = applyDeadzone(gp.axes[1] ?? 0);
        const rx = applyDeadzone(gp.axes[2] ?? 0);
        const ry = applyDeadzone(gp.axes[3] ?? 0);

        const dpad = dpadMove(gp);
        let moveX = lx || dpad.x;
        let moveY = -ly || dpad.y;
        const moveLen = Math.hypot(moveX, moveY);
        if (moveLen > 1) {
            moveX /= moveLen;
            moveY /= moveLen;
        }

        const aimLen = Math.hypot(rx, ry);
        const aimDir = aimLen > 0.05
            ? v2.create(rx / aimLen, -ry / aimLen)
            : v2.create(1, 0);

        const prev = this.prevButtons;
        const pressed = (i: number) => btnPressed(gp!, i, !!prev[i]);
        const nextPrev: boolean[] = [];

        for (let i = 0; i < gp.buttons.length; i++) {
            nextPrev[i] = btn(gp, i);
        }
        this.prevButtons = nextPrev;

        const rtAxis = (gp.axes[5] ?? 0) > TRIGGER_THRESHOLD;
        const ltAxis = (gp.axes[4] ?? 0) > TRIGGER_THRESHOLD;

        // 0 bottom, 1 right, 2 left, 3 top — Xbox A/B/X/Y; PS Cross/Circle/Square/Triangle
        const fire = btn(gp, 0) || trigger(gp, 7, 5);
        const reload = btn(gp, 2) || trigger(gp, 6, 4);
        const interact = btn(gp, 3);
        const cancel = btn(gp, 1);
        const nextWeap = btn(gp, 5);
        const prevWeap = btn(gp, 4);
        const mapBtn = btn(gp, 9);
        const emoteBtn = btn(gp, 8);

        const firePressed = pressed(0)
            || triggerPressed(gp, 7, 5, !!prev[7], this.prevRtAxis);
        const reloadPressed = pressed(2)
            || triggerPressed(gp, 6, 4, !!prev[6], this.prevLtAxis);

        this.prevRtAxis = rtAxis;
        this.prevLtAxis = ltAxis;

        const menuUp = dpad.y > 0 || ly < -0.5;
        const menuDown = dpad.y < 0 || ly > 0.5;
        const menuLeft = dpad.x < 0 || lx < -0.5;
        const menuRight = dpad.x > 0 || lx > 0.5;
        const menuUpPressed = menuUp && !this.prevMenuUp;
        const menuDownPressed = menuDown && !this.prevMenuDown;
        const menuLeftPressed = menuLeft && !this.prevMenuLeft;
        const menuRightPressed = menuRight && !this.prevMenuRight;
        this.prevMenuUp = menuUp;
        this.prevMenuDown = menuDown;
        this.prevMenuLeft = menuLeft;
        this.prevMenuRight = menuRight;

        return {
            active: true,
            moveX,
            moveY,
            aimDir,
            aimLen: math.clamp(aimLen, 0, 1),
            fire,
            firePressed,
            reload,
            reloadPressed,
            interact,
            interactPressed: pressed(3),
            cancel,
            cancelPressed: pressed(1),
            nextWeap,
            prevWeap,
            map: mapBtn,
            mapPressed: pressed(9),
            emote: emoteBtn,
            emotePressed: pressed(8) || pressed(10),
            confirm: btn(gp, 0),
            confirmPressed: pressed(0),
            back: btn(gp, 1),
            backPressed: pressed(1),
            menuUp,
            menuUpPressed,
            menuDown,
            menuDownPressed,
            menuLeft,
            menuLeftPressed,
            menuRight,
            menuRightPressed,
            menuTabPrevPressed: pressed(4),
            menuTabNextPressed: pressed(5),
        };
    }
}
