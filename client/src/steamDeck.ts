import { device } from "./device.ts";
import { helpers } from "./helpers.ts";

export function setupSteamDeck() {
    if (!device.steamDeck) return;

    document.body.classList.add("steam-deck");
    document.documentElement.style.overscrollBehavior = "none";
}

export function requestSteamDeckFullscreen() {
    if (!device.steamDeck) return;
    if (
        document.fullscreenElement
        || document.mozFullScreenElement
        || document.webkitFullscreenElement
        || document.msFullscreenElement
    ) {
        return;
    }
    helpers.toggleFullScreen();
}

export function focusGameCanvas() {
    if (!device.steamDeck) return;
    const canvas = document.querySelector<HTMLElement>("#cvs");
    canvas?.focus();
}
