import { ObjectType } from "../../../../shared/net/objectSerializeFns.ts";
import { collider } from "../../../../shared/utils/collider.ts";
import { v2, type Vec2 } from "../../../../shared/utils/v2.ts";
import type { Game } from "../game.ts";
import { BaseGameObject } from "./gameObject.ts";

export const SpecOpsDeadBodyLifetime = 18;
export const SpecOpsDeadBodyCap = 16;
const DeadBodyLifetime = 50;
const DeadBodyCap = 40;

export class DeadBodyBarn {
    deadBodies: DeadBody[] = [];

    constructor(readonly game: Game) {}

    update(dt: number) {
        const specOps = this.game.map.specOpsMode;
        const lifetime = specOps ? SpecOpsDeadBodyLifetime : DeadBodyLifetime;
        const cap = specOps ? SpecOpsDeadBodyCap : DeadBodyCap;

        for (let i = 0; i < this.deadBodies.length; i++) {
            const deadBody = this.deadBodies[i];
            if (deadBody.destroyed) {
                this.deadBodies.splice(i, 1);
                i--;
                continue;
            }
            deadBody.age += dt;
            if (deadBody.age >= lifetime) {
                deadBody.destroy();
                this.deadBodies.splice(i, 1);
                i--;
                continue;
            }
            deadBody.update(dt);
        }

        if (this.deadBodies.length > cap) {
            const overflow = this.deadBodies.length - cap;
            for (let i = 0; i < overflow; i++) {
                this.deadBodies[i].destroy();
            }
            this.deadBodies.splice(0, overflow);
        }
    }

    addDeadBody(pos: Vec2, playerId: number, layer: number, dir: Vec2) {
        const deadBody = new DeadBody(this.game, pos, playerId, layer, dir);
        this.deadBodies.push(deadBody);
        this.game.objectRegister.register(deadBody);
    }
}

export class DeadBody extends BaseGameObject {
    bounds = collider.createAabbExtents(v2.create(0, 0), v2.create(2, 2));

    override readonly __type = ObjectType.DeadBody;

    layer: number;
    playerId: number;

    vel: Vec2;
    oldPos: Vec2;
    age = 0;

    constructor(game: Game, pos: Vec2, playerId: number, layer: number, dir: Vec2) {
        super(game, pos);
        this.layer = layer;
        this.playerId = playerId;
        this.vel = v2.mul(dir, 10);
        this.oldPos = v2.copy(this.pos);
    }

    update(dt: number): void {
        const moving = Math.abs(this.vel.x) > 0.001
            || Math.abs(this.vel.y) > 0.001
            || !v2.eq(this.oldPos, this.pos);

        if (!moving) return;

        v2.set(this.oldPos, this.pos);

        v2.set(this.vel, v2.mul(this.vel, 1 / (1 + dt * 4)));
        v2.set(this.pos, v2.add(this.pos, v2.mul(this.vel, dt)));

        this.game.map.clampToMapBounds(this.pos);

        const originalLayer = this.layer;
        const objs = this.game.grid.intersectGameObject(this);
        this.checkStairs(objs, 2);

        this.game.map.clampToMapBounds(this.pos);

        if (this.layer !== originalLayer) {
            this.setDirty();
        }

        if (!v2.eq(this.oldPos, this.pos)) {
            this.setPartDirty();
            this.game.grid.updateObject(this);
        }
    }
}
