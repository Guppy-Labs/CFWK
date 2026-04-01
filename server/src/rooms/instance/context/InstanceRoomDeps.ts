import { AdvancementsManager } from "../../../managers/AdvancementsManager";
import { GlimmerbowlCache } from "../../../managers/GlimmerbowlCache";
import { InstanceManager } from "../../../managers/InstanceManager";
import { InventoryCache } from "../../../managers/InventoryCache";
import { PlayerStatsCache } from "../../../managers/PlayerStatsCache";
import { ServerMapNavService } from "../../../ai/ServerMapNavService";

export type InstanceRoomDeps = {
    instanceManager: InstanceManager;
    inventoryCache: InventoryCache;
    glimmerbowlCache: GlimmerbowlCache;
    playerStatsCache: PlayerStatsCache;
    navService: ServerMapNavService;
    createAdvancementsManager: (mapFile: string) => AdvancementsManager;
};

export function createDefaultInstanceRoomDeps(): InstanceRoomDeps {
    return {
        instanceManager: InstanceManager.getInstance(),
        inventoryCache: InventoryCache.getInstance(),
        glimmerbowlCache: GlimmerbowlCache.getInstance(),
        playerStatsCache: PlayerStatsCache.getInstance(),
        navService: new ServerMapNavService(),
        createAdvancementsManager: (mapFile: string) => new AdvancementsManager(mapFile)
    };
}
