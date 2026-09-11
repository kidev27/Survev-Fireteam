import * as PIXI from "pixi.js-legacy";

import type { RoleDef } from "../../../shared/defs/gameObjects/roleDefs.ts";
import { SpecOpsContractHoldRadius } from "../../../shared/defs/maps/specOpsContracts.ts";
import { GameObjectDefs } from "../../../shared/defs/register.ts";
import type { MapIndicator } from "../../../shared/net/updateMsg.ts";
import { math } from "../../../shared/utils/math.ts";
import { assert } from "../../../shared/utils/util.ts";
import { v2, type Vec2 } from "../../../shared/utils/v2.ts";
import type { Camera } from "../camera.ts";
import { device } from "../device.ts";
import type { Map } from "../map.ts";
import type { Renderer } from "../renderer.ts";
import type { UiManager } from "../ui/ui.ts";
import type { MapSprite, MapSpriteBarn } from "./mapSprite.ts";

interface Indicator {
    id: number;
    type: string;
    pos: Vec2;
    equipped: boolean;
    mapSprite: MapSprite;
    pulseSprite: MapSprite;
    pulseScale: number;
    pulseScaleMin: number;
    pulseScaleMax: number;
    pulseTicker: number;
    pulseDir: number;
    pulseSpeed: number;
    /** World-space stand radius (0 = pin only). */
    zoneRad: number;
    zoneTint: number;
    mapZoneGfx: PIXI.Graphics | null;
    worldZoneGfx: PIXI.Graphics | null;
    zoneMapRad: number;
    zoneScreenRad: number;
    zoneMapPos: Vec2;
    zoneScreenPos: Vec2;
}

function zoneRadForType(type: string): number {
    if (type === "specops_contract_hold") return SpecOpsContractHoldRadius;
    return 0;
}

function zoneTintForType(type: string, fallback: number): number {
    if (type === "specops_contract_hold") return 0xffcc44;
    return fallback;
}

export class MapIndicatorBarn {
    mapIndicators: Indicator[] = [];
    idToMapIdicator: Record<number, Indicator> = {};

    constructor(public mapSpriteBarn: MapSpriteBarn) {}

    updateIndicatorData(indicatorData: MapIndicator[]) {
        for (let i = 0; i < indicatorData.length; i++) {
            const data = indicatorData[i];
            if (data.dead) {
                this.removeIndicator(data.id);
            } else {
                this.updateIndicator(data);
            }
        }
    }

    addIndicator(data: MapIndicator) {
        const zoneRad = zoneRadForType(data.type);
        const indicator: Indicator = {
            id: data.id,
            type: data.type,
            pos: v2.copy(data.pos),
            equipped: data.equipped,
            mapSprite: this.mapSpriteBarn.addSprite(),
            pulseSprite: this.mapSpriteBarn.addSprite(),
            pulseScale: 0.5,
            pulseScaleMin: 0.5,
            pulseScaleMax: 1,
            pulseTicker: 0,
            pulseDir: 1,
            pulseSpeed: 0.3,
            zoneRad,
            zoneTint: zoneTintForType(data.type, 0xffffff),
            mapZoneGfx: null,
            worldZoneGfx: null,
            zoneMapRad: -1,
            zoneScreenRad: -1,
            zoneMapPos: v2.create(0, 0),
            zoneScreenPos: v2.create(0, 0),
        };
        if (zoneRad > 0) {
            indicator.mapZoneGfx = new PIXI.Graphics();
            (indicator.mapZoneGfx as PIXI.Graphics & { __zOrder: number }).__zOrder = 0;
            this.mapSpriteBarn.container.addChild(indicator.mapZoneGfx);

            indicator.worldZoneGfx = new PIXI.Graphics();
            indicator.worldZoneGfx.visible = false;
        }
        this.mapIndicators.push(indicator);
        this.idToMapIdicator[data.id] = indicator;
        return indicator;
    }

    removeIndicator(id: number) {
        for (let i = 0; i < this.mapIndicators.length; i++) {
            const indicator = this.mapIndicators[i];
            if (indicator.id == id) {
                indicator.mapSprite.free();
                indicator.pulseSprite.free();
                if (indicator.mapZoneGfx) {
                    indicator.mapZoneGfx.parent?.removeChild(indicator.mapZoneGfx);
                    indicator.mapZoneGfx.destroy();
                    indicator.mapZoneGfx = null;
                }
                if (indicator.worldZoneGfx) {
                    indicator.worldZoneGfx.parent?.removeChild(indicator.worldZoneGfx);
                    indicator.worldZoneGfx.destroy();
                    indicator.worldZoneGfx = null;
                }
                this.mapIndicators.splice(i, 1);
                delete this.idToMapIdicator[id];
                break;
            }
        }
    }

    updateIndicator(data: MapIndicator) {
        let indicator = this.idToMapIdicator[data.id];
        indicator ||= this.addIndicator(data);

        indicator.pos = v2.copy(data.pos);
        indicator.equipped = data.equipped;

        const objDef = GameObjectDefs.typeToDef(indicator.type) as RoleDef;
        assert(objDef.mapIndicator);
        const scale = (device.uiLayout == device.UiLayout.Sm ? 0.15 : 0.2) * 1.25;
        const zOrder = indicator.equipped ? 655350 : 1;

        const mapSprite = indicator.mapSprite;
        mapSprite.pos = v2.copy(indicator.pos);
        mapSprite.scale = scale;
        mapSprite.alpha = 1;
        mapSprite.zOrder = zOrder;
        mapSprite.visible = true;
        mapSprite.sprite.texture = PIXI.Texture.from(objDef.mapIndicator!.sprite);

        mapSprite.sprite.tint = objDef.mapIndicator?.tint ?? 0xffffff;
        indicator.zoneTint = zoneTintForType(
            indicator.type,
            objDef.mapIndicator?.tint ?? 0xffffff,
        );
        if (objDef.mapIndicator?.pulse) {
            const pulseSprite = indicator.pulseSprite;
            pulseSprite.pos = v2.copy(indicator.pos);
            pulseSprite.scale = 1;
            pulseSprite.zOrder = zOrder - 1;
            pulseSprite.visible = true;
            pulseSprite.sprite.texture = PIXI.Texture.from("part-pulse-01.img");
            pulseSprite.sprite.tint = objDef.mapIndicator.pulseTint;
        }
    }

    updateIndicatorPulses(dt: number) {
        for (let i = 0; i < this.mapIndicators.length; i++) {
            const indicator = this.mapIndicators[i];
            indicator.pulseTicker = math.clamp(
                indicator.pulseTicker + dt * indicator.pulseDir * indicator.pulseSpeed,
                indicator.pulseScaleMin,
                1,
            );

            // Ease up and down
            indicator.pulseScale = indicator.pulseTicker * indicator.pulseScaleMax;
            if (
                indicator.pulseScale >= indicator.pulseScaleMax
                || indicator.pulseTicker <= indicator.pulseScaleMin
            ) {
                indicator.pulseDir *= -1;
            }
            indicator.pulseSprite.scale = indicator.pulseScale;
            indicator.pulseSprite.visible = indicator.equipped;
        }
    }

    /**
     * Draw stand-radius rings for contract hold zones on the minimap and in-world.
     */
    renderZones(
        uiManager: UiManager,
        map: Map,
        camera: Camera,
        renderer: Renderer,
    ) {
        for (let i = 0; i < this.mapIndicators.length; i++) {
            const indicator = this.mapIndicators[i];
            if (indicator.zoneRad <= 0 || !indicator.mapZoneGfx || !indicator.worldZoneGfx) {
                continue;
            }

            const mapPos = uiManager.getMapPosFromWorldPos(indicator.pos, map);
            const mapEdge = uiManager.getMapPosFromWorldPos(
                v2.add(indicator.pos, v2.create(indicator.zoneRad, 0)),
                map,
            );
            const mapRad = v2.length(v2.sub(mapEdge, mapPos));

            const mapGfx = indicator.mapZoneGfx;
            const mapPosChanged = !v2.eq(indicator.zoneMapPos, mapPos, 0.0001);
            const mapRadChanged = !math.eqAbs(indicator.zoneMapRad, mapRad, 0.0001);
            if (mapPosChanged) {
                indicator.zoneMapPos = v2.copy(mapPos);
                mapGfx.position.set(mapPos.x, mapPos.y);
            }
            if (mapRadChanged) {
                indicator.zoneMapRad = mapRad;
                mapGfx.clear();
                mapGfx.lineStyle(2, indicator.zoneTint, 0.95);
                mapGfx.beginFill(indicator.zoneTint, 0.18);
                mapGfx.drawCircle(0, 0, mapRad);
                mapGfx.endFill();
            }
            mapGfx.visible = true;
            (mapGfx as PIXI.Graphics & { __zOrder: number }).__zOrder = 0;

            const screenPos = camera.m_pointToScreen(indicator.pos);
            const screenRad = camera.m_scaleToScreen(indicator.zoneRad);
            const worldGfx = indicator.worldZoneGfx;
            const screenPosChanged = !v2.eq(indicator.zoneScreenPos, screenPos, 0.0001);
            const screenRadChanged = !math.eqAbs(indicator.zoneScreenRad, screenRad, 0.0001);
            if (screenPosChanged) {
                indicator.zoneScreenPos = v2.copy(screenPos);
                worldGfx.position.set(screenPos.x, screenPos.y);
            }
            if (screenRadChanged) {
                indicator.zoneScreenRad = screenRad;
                worldGfx.clear();
                worldGfx.lineStyle(2.5, indicator.zoneTint, 0.85);
                worldGfx.beginFill(indicator.zoneTint, 0.12);
                worldGfx.drawCircle(0, 0, screenRad);
                worldGfx.endFill();
            }
            worldGfx.visible = true;
            // Under players/loot, above ground decals.
            renderer.addPIXIObj(worldGfx, 0, 8);
        }
    }
}
