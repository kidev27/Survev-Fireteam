import { ensureGamepadWakeup } from "./gamepad.ts";
import { MenuGamepadNav } from "./ui/menuGamepad.ts";

const menuGamepad = new MenuGamepadNav();

/** Enable gamepad navigation on the main menu for all platforms. */
export function setupMenuGamepad() {
    ensureGamepadWakeup();
    menuGamepad.start();
    window.addEventListener("beforeunload", () => {
        menuGamepad.stop();
    });
}
