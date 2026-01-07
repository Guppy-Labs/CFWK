import Phaser from 'phaser';
import { Config } from '../config';
import { IMap, MapLayer } from '@cfwk/shared';

export class MapTesterScene extends Phaser.Scene {
    private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    private mapData: IMap | null = null;
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    private mapId: string | null = null;
    private colliders: Phaser.Physics.Arcade.StaticGroup[] = [];
    private tileRegistry: Map<string, any> = new Map();

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
            g.fillRect(0,0,24,24);
            g.generateTexture('player', 24, 24);
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
            Object.values(this.mapData.layers).forEach(layer => {
                if (layer) {
                    Object.values(layer).forEach((tileId: string) => {
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

        const layers = [MapLayer.BACKGROUND, MapLayer.GROUND, MapLayer.WALL, MapLayer.DECO, MapLayer.OBJECT];
        
        layers.forEach(layerKey => {
            if (!this.mapData?.layers) return;
            const layerData = this.mapData.layers[layerKey];
            
            if (!layerData) return;

            const props = this.mapData.layerProperties?.[layerKey];
            const isCollidable = props?.collidable ?? false;

            let colliderGroup: Phaser.Physics.Arcade.StaticGroup | null = null;
            if (isCollidable) {
                colliderGroup = this.physics.add.staticGroup();
                this.colliders.push(colliderGroup);
            }

            Object.entries(layerData).forEach(([coord, tileId]) => {
                const [gx, gy] = coord.split(',').map(Number);
                if (this.textures.exists(tileId)) {
                    if (isCollidable && colliderGroup) {
                         const tile = colliderGroup.create(gx * 32 + 16, gy * 32 + 16, tileId);
                         tile.setDisplaySize(32, 32);
                         tile.refreshBody(); // important for static physics body resize
                    } else {
                         const img = this.add.image(gx * 32 + 16, gy * 32 + 16, tileId);
                         img.setDisplaySize(32, 32);
                    }
                }
            });
        });
    }

    private spawnPlayer() {
        if (!this.mapData) return;
        
        const cx = (this.mapData.width * 32) / 2;
        const cy = (this.mapData.height * 32) / 2;
        
        this.player = this.physics.add.sprite(cx, cy, 'player');
        this.player.setCollideWorldBounds(true);
        this.player.setDisplaySize(24, 24);
        
        this.cameras.main.startFollow(this.player, true);

        // colliders
        this.colliders.forEach(group => {
            this.physics.add.collider(this.player, group);
        });
    }

    update() {
        if (!this.player || !this.cursors) return;

        const speed = 200;
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
    }
}
