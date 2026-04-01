import { Schema, MapSchema, type } from "@colyseus/schema";
import { InstancePlayerSchema } from "./InstancePlayerSchema";
import { InstanceAiNpcSchema } from "./InstanceAiNpcSchema";
import { DroppedItemSchema } from "./DroppedItemSchema";
import { WorldTimeSchema } from "./WorldTimeSchema";

export class InstanceState extends Schema {
    @type("string") instanceId: string = "";
    @type("string") locationId: string = "";
    @type("string") mapFile: string = "";
    @type({ map: InstancePlayerSchema }) players = new MapSchema<InstancePlayerSchema>();
    @type({ map: InstanceAiNpcSchema }) aiNpcs = new MapSchema<InstanceAiNpcSchema>();
    @type({ map: DroppedItemSchema }) droppedItems = new MapSchema<DroppedItemSchema>();
    @type(WorldTimeSchema) worldTime = new WorldTimeSchema();
}
