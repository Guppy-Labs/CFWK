import Phaser from 'phaser';

export type CameraControllerOptions = {
    zoom?: number;
    /** Reference viewport size in world pixels - all screens will see this much area */
    referenceViewport?: { width: number; height: number };
};

export class CameraController {
    private scene: Phaser.Scene;
    private camera: Phaser.Cameras.Scene2D.Camera;
    private map: Phaser.Tilemaps.Tilemap;
    private target: Phaser.GameObjects.GameObject;
    private baseZoom: number;
    private referenceViewport: { width: number; height: number };

    constructor(
        scene: Phaser.Scene,
        map: Phaser.Tilemaps.Tilemap,
        target: Phaser.GameObjects.GameObject,
        options: CameraControllerOptions = {}
    ) {
        this.scene = scene;
        this.camera = scene.cameras.main;
        this.map = map;
        this.target = target;

        this.baseZoom = options.zoom ?? 2;
        // Reference viewport: all players see at most this many world pixels
        // Default to 384x288 (12x9 tiles at 32px) for a fair view
        this.referenceViewport = options.referenceViewport ?? { width: 384, height: 288 };
        this.camera.setZoom(this.baseZoom);
        this.camera.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
        this.camera.setRoundPixels(false);
        this.camera.startFollow(target, false, 1, 1);
        this.camera.setDeadzone(0, 0);

        this.scene.scale.on('resize', this.handleResize, this);
        this.handleResize(this.scene.scale.gameSize);
    }

    destroy() {
        this.scene.scale.off('resize', this.handleResize, this);
    }

    private handleResize(gameSize: Phaser.Structs.Size) {
        this.camera.setViewport(0, 0, gameSize.width, gameSize.height);

        // Calculate zoom so that viewport shows at most referenceViewport world pixels
        // Use the smaller dimension ratio (max zoom) so no one sees more than the reference
        const zoomX = gameSize.width / this.referenceViewport.width;
        const zoomY = gameSize.height / this.referenceViewport.height;
        const fairZoom = Math.min(zoomX, zoomY);

        // Also ensure we fill the map (no black bars) if the map is smaller than reference
        const fillZoomX = gameSize.width / this.map.widthInPixels;
        const fillZoomY = gameSize.height / this.map.heightInPixels;
        const fillZoom = Math.max(fillZoomX, fillZoomY);

        this.camera.setZoom(Math.max(fairZoom, fillZoom));
    }
}
