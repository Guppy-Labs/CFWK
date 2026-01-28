/**
 * LEGACY MAP TESTER
 * Used to validate maps from the deprecated custom editor. New TMX maps will
 * be tested with a separate Phaser Tilemap workflow.
 */
import { IMap, SYSTEM_TILES } from '@cfwk/shared';

export class MapTesterScene extends Phaser.Scene {
    private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    private mapData: IMap | null = null;
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    private mapId: string | null = null;
    private colliders: Phaser.Physics.Arcade.StaticGroup[] = [];
    private tileRegistry: Map<string, any> = new Map();

    // Above/Overhead system
    private aboveClusters: Map<number, Phaser.GameObjects.Image[]> = new Map();
    private aboveGrid: Map<string, number> = new Map(); // "x,y" -> clusterId
    private activeClusterIds: Set<number> = new Set();

    constructor() {
        super('MapTesterScene');
    }

    init(data: { mapId: string }) {
        this.mapId = data.mapId;
    }

    preload() {
        if (!this.textures.exists('player')) {
            const g = this.make.graphics({x:0, y:0});
            g.fillStyle(0x00ff00);
            g.fillRect(0,0,24,51);
            g.generateTexture('player', 24, 51);
        }
        if (!this.textures.exists(SYSTEM_TILES.INVISIBLE)) {
            const g = this.make.graphics({ x: 0, y: 0 });
            g.fillStyle(0x000000, 1/255);
            g.fillRect(0, 0, 32, 32);
            g.generateTexture(SYSTEM_TILES.INVISIBLE, 32, 32);
        }
    }

    async create() {
        this.cameras.main.setBackgroundColor('#222');
        
        if (!this.mapId) {
            this.add.text(100, 100, 'No Map ID provided', { color: '#ff0000' });
            return;
        }

        try {
            const [mapRes, tilesRes] = await Promise.all([
                 fetch(Config.getApiUrl(`/maps/${this.mapId}`)),
                 fetch(Config.getApiUrl('/tiles'))
            ]);
            
            this.mapData = await mapRes.json();
            const tiles = await tilesRes.json();
            if (Array.isArray(tiles)) {
                tiles.forEach((t: any) => this.tileRegistry.set(t.id, t));
            }
            
            this.buildMap();
        } catch (e) {
            console.error(e);
            this.add.text(100, 100, 'Failed to load map data', { color: '#ff0000' });
        }

        const btn = this.add.text(10, 10, '< Back to Test Menu', { 
            fontSize: '16px', 
            backgroundColor: '#000', 
            padding: { x: 10, y: 5 }
        })
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
            window.location.href = '/maps/test';
        });

        if (this.input.keyboard) {
            this.cursors = this.input.keyboard.createCursorKeys();
        }
    }

    private buildMap() {
        if (!this.mapData) return;
        
        // unique ids
        const usedTileIds = new Set<string>();

        // get palette
        const traversePalette = (list: any[]) => {
            list.forEach(item => {
                if (typeof item === 'string') {
                    usedTileIds.add(item);
                } else if (item.itemType === 'folder' && item.items) {
                    traversePalette(item.items);
                } else if (item.id) {
                    usedTileIds.add(item.id);
                }
            });
        };
        if (this.mapData.palette) {
            traversePalette(this.mapData.palette);
        }

        // 2. from layers
        if (this.mapData.layers) {
            this.mapData.layers.forEach(layer => {
                if (layer && layer.data) {
                    Object.values(layer.data).forEach((tileId: string) => {
                         if (tileId) usedTileIds.add(tileId);
                    });
                }
            });
        }

        // queue
        const toLoad: string[] = [];
        usedTileIds.forEach(id => {
             if (!this.textures.exists(id)) {
                 const def = this.tileRegistry.get(id);
                 if (def && def.imageUrl) {
                     this.load.image(id, Config.getImageUrl(def.imageUrl));
                     toLoad.push(id);
                 }
             }
        });

        if (toLoad.length > 0) {
            this.load.once('complete', () => {
                this.renderLayers();
                this.spawnPlayer();
            });
            this.load.start();
        } else {
            this.renderLayers();
            this.spawnPlayer();
        }
    }

    private renderLayers() {
        if (!this.mapData) return;
        
        // world bounds
        this.physics.world.setBounds(0, 0, this.mapData.width * 32, this.mapData.height * 32);
        this.cameras.main.setBounds(0, 0, this.mapData.width * 32, this.mapData.height * 32);

        const aboveImages: { x: number, y: number, image: Phaser.GameObjects.Image }[] = [];

        this.mapData.layers.forEach((layer, index) => {
            if (layer.visible === false) return; // default true

            // Legacy support: check both properties.collidable and root collidable
            const isCollidable = (layer.properties?.collidable === true) || ((layer as any).collidable === true);
            const isAbove = layer.properties?.above === true;

            let colliderGroup: Phaser.Physics.Arcade.StaticGroup | null = null;
            if (isCollidable) {
                colliderGroup = this.physics.add.staticGroup();
                this.colliders.push(colliderGroup);
            }

            Object.entries(layer.data).forEach(([coord, tileId]) => {
                if (tileId === SYSTEM_TILES.SPAWN) return; // Do not render spawn point
                
                const [gx, gy] = coord.split(',').map(Number);
                if (this.textures.exists(tileId as string)) {
                    if (isCollidable && colliderGroup) {
                         const tile = colliderGroup.create(gx * 32 + 16, gy * 32 + 16, tileId as string);
                         tile.setDisplaySize(32, 32);
                         tile.refreshBody(); // important for static physics body resize
                         
                         // Fix for invisible tiles in tester:
                         if (tileId === SYSTEM_TILES.INVISIBLE) {
                             // Force full box
                             tile.setSize(32,32);
                         } 
                         else if (tileId !== SYSTEM_TILES.COLLISION) {
                             // Attempt to match size for others later if needed, but tester is simple
                         }

                         tile.setDepth(index * 10);
                    } else {
                         const img = this.add.image(gx * 32 + 16, gy * 32 + 16, tileId as string);
                         img.setDisplaySize(32, 32);
                         
                         if (isAbove) {
                             img.setDepth(2000 + index); // High depth for overhead
                             aboveImages.push({ x: gx, y: gy, image: img });
                         } else {
                             img.setDepth(index * 10);
                         }
                    }
                }
            });
        });

        this.buildAboveClusters(aboveImages);
    }

    private buildAboveClusters(aboveImages: { x: number, y: number, image: Phaser.GameObjects.Image }[]) {
        this.aboveClusters.clear();
        this.aboveGrid.clear();
        this.activeClusterIds.clear();

        // Group images by coordinate
        const byCoord = new Map<string, Phaser.GameObjects.Image[]>();
        aboveImages.forEach(item => {
            const key = `${item.x},${item.y}`;
            if (!byCoord.has(key)) byCoord.set(key, []);
            byCoord.get(key)!.push(item.image);
        });
        
        // Build clusters (BFS)
        const coords = Array.from(byCoord.keys());
        const visited = new Set<string>();
        let nextClusterId = 1;
        
        coords.forEach(startKey => {
            if (visited.has(startKey)) return;
            
            const clusterId = nextClusterId++;
            const queue = [startKey];
            visited.add(startKey);
            this.aboveClusters.set(clusterId, []);
            
            while(queue.length > 0) {
                const key = queue.shift()!;
                const [cx, cy] = key.split(',').map(Number);
                
                // Add to cluster
                this.aboveGrid.set(key, clusterId);
                const imgs = byCoord.get(key);
                if (imgs) this.aboveClusters.get(clusterId)!.push(...imgs);
                
                // Check neighbors
                const neighbors = [
                    `${cx+1},${cy}`, `${cx-1},${cy}`, `${cx},${cy+1}`, `${cx},${cy-1}`
                ];
                
                neighbors.forEach(nKey => {
                    if (byCoord.has(nKey) && !visited.has(nKey)) {
                        visited.add(nKey);
                        queue.push(nKey);
                    }
                });
            }
        });
    }

    private spawnPlayer() {
        if (!this.mapData) return;
        
        let cx = (this.mapData.width * 32) / 2;
        let cy = (this.mapData.height * 32) / 2;

        // Find Spawn Point
        let found = false;
        for (const layer of this.mapData.layers) {
            if (found) break;
            if (!layer || !layer.data) continue;
            for (const [coord, tileId] of Object.entries(layer.data)) {
                if (tileId === SYSTEM_TILES.SPAWN) {
                    const [gx, gy] = coord.split(',').map(Number);
                    cx = gx * 32 + 16;
                    cy = gy * 32 + 16;
                    found = true;
                    break; 
                }
            }
        }
        
        this.player = this.physics.add.sprite(cx, cy, 'player');
        this.player.setCollideWorldBounds(true);
        this.player.setDisplaySize(24, 51);
        this.player.body.setSize(24, 25);
        this.player.body.setOffset(0, 26);
        this.player.setDepth(1000); // Between standard layers and Above layers
        
        this.cameras.main.startFollow(this.player, true);
        this.cameras.main.setZoom(1.3);

        // colliders
        this.colliders.forEach(group => {
            this.physics.add.collider(this.player, group);
        });
    }

    update() {
        if (!this.player || !this.cursors) return;

        const speed = 100;
        this.player.setVelocity(0);

        if (this.cursors.left.isDown) {
            this.player.setVelocityX(-speed);
        } else if (this.cursors.right.isDown) {
            this.player.setVelocityX(speed);
        }

        if (this.cursors.up.isDown) {
            this.player.setVelocityY(-speed);
        } else if (this.cursors.down.isDown) {
            this.player.setVelocityY(speed);
        }
        
        // normalize vector
        if (this.player.body.velocity.x !== 0 && this.player.body.velocity.y !== 0) {
            this.player.body.velocity.normalize().scale(speed);
        }

        // Handle Above Layer Fading with margin
        const margin = 8;
        const width = 24; 
        const height = 51; 
        
        // Trigger Box relative to player center
        const minX = this.player.x - (width/2) - margin;
        const maxX = this.player.x + (width/2) + margin;
        const minY = this.player.y - (height/2) - margin;
        const maxY = this.player.y + (height/2) + margin;
        
        // Convert to Tile Coords range
        const tMinX = Math.floor(minX / 32);
        const tMaxX = Math.floor(maxX / 32);
        const tMinY = Math.floor(minY / 32);
        const tMaxY = Math.floor(maxY / 32);
        
        const currentClusterIds = new Set<number>();
        
        for (let ty = tMinY; ty <= tMaxY; ty++) {
            for (let tx = tMinX; tx <= tMaxX; tx++) {
                const key = `${tx},${ty}`;
                const cId = this.aboveGrid.get(key);
                if (cId !== undefined) {
                    currentClusterIds.add(cId);
                }
            }
        }

        // 1. If in active but not current -> Fade In (Restore)
        this.activeClusterIds.forEach(id => {
            if (!currentClusterIds.has(id)) {
                const imgs = this.aboveClusters.get(id);
                if (imgs) {
                    this.tweens.add({ targets: imgs, alpha: 1, duration: 200 });
                }
                this.activeClusterIds.delete(id);
            }
        });
        
        // 2. If in current but not active -> Fade Out (Transparent)
        currentClusterIds.forEach(id => {
            if (!this.activeClusterIds.has(id)) {
                const imgs = this.aboveClusters.get(id);
                if (imgs) {
                    this.tweens.add({ targets: imgs, alpha: 0.4, duration: 200 });
                }
                this.activeClusterIds.add(id);
            }
        });
    }
}
