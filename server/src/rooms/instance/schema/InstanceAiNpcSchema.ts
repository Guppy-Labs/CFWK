import { Schema, type } from "@colyseus/schema";
import { AINpcAnim } from "@cfwk/shared";

export class AiNpcHitboxSchema extends Schema {
    @type("number") width: number = 16;
    @type("number") height: number = 25;
    @type("number") collidableHeight: number = 6;
}

export class InstanceAiNpcSchema extends Schema {
    @type("string") id: string = "";
    @type("string") kind: string = "";
    @type("string") controllerId: string = "";
    @type("number") x: number = 0;
    @type("number") y: number = 0;
    @type("number") vx: number = 0;
    @type("number") vy: number = 0;
    @type("number") moveTs: number = 0;
    @type("number") direction: number = 0;
    @type("string") anim: AINpcAnim = "idle";
    @type("number") tint: number = 0xffffff;
    @type("number") currentHealth: number = 1;
    @type("number") maxHealth: number = 1;
    @type("string") pathDebug: string = "";
    @type(AiNpcHitboxSchema) hitbox = new AiNpcHitboxSchema();
}
