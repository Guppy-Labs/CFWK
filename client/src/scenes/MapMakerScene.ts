import Phaser from 'phaser';
import { MapMakerUI } from '../mapmaker/MapMakerUI';
import { ITile, ITileGroup, IMap, MapLayer, MapState } from '@cfwk/shared';
import { Config } from '../config';

export class MapMakerScene extends Phaser.Scene {
    private ui!: MapMakerUI;
    private gridGraphics!: Phaser.GameObjects.Graphics;
    private highlightGraphics!: Phaser.GameObjects.Graphics;
    private mapData: IMap | null = null;
    private tileGroup!: Phaser.GameObjects.Group;
    private cursorGroup!: Phaser.GameObjects.Group;
    private dimTexture!: Phaser.GameObjects.RenderTexture;
    
    // editor state
    private selectedTool: 'place' | 'erase' | 'fill' | 'select' = 'place';
    private selectedLayer: MapLayer = MapLayer.BACKGROUND;
    private selectedTileId: string | null = null;
    private brushRadius: number = 1;
    private diffusion: number = 100;
    private shape: 'square' | 'circle' | 'perlin-square' | 'perlin-circle' | 'freeform' = 'square';
    private availableTiles: (ITile | ITileGroup)[] = [];
    
    // selection state
    private selection: Set<string> = new Set();
    private isSelecting: boolean = false;
    private selectionStart: {x:number, y:number} | null = null;
    private selectionMoving: boolean = false;
    private selectionMoveOffset: {x:number, y:number} = {x:0,y:0};
    private selectionFloatingGroup!: Phaser.GameObjects.Group;
    private isPasteMode: boolean = false;
    private pastePreview: {x:number, y:number, id:string}[] = [];

    private layerVisibility: Record<MapLayer, boolean> = {
        [MapLayer.BACKGROUND]: true,
        [MapLayer.GROUND]: true,
        [MapLayer.WALL]: true,
        [MapLayer.DECO]: true,
        [MapLayer.OBJECT]: true
    };
    private layerLocked: Record<MapLayer, boolean> = {
        [MapLayer.BACKGROUND]: false,
        [MapLayer.GROUND]: false,
        [MapLayer.WALL]: false,
        [MapLayer.DECO]: false,
        [MapLayer.OBJECT]: false
    };

    // state tracking
    private lastFootprint: Set<string> = new Set();
    private isDragging: boolean = false;
    private dragStart: Phaser.Math.Vector2 = new Phaser.Math.Vector2();
    private cameraStart: Phaser.Math.Vector2 = new Phaser.Math.Vector2();
    
    // zoom targets
    private targetZoom: number = 1;
    private targetScroll: Phaser.Math.Vector2 = new Phaser.Math.Vector2();
    private lastZoom: number = 0;
    private noiseSeed: number = Math.random() * 1000;

    // autosave
    private lastEditTime: number = 0;
    private hasUnsavedChanges: boolean = false;

    // history
    private historyStack: string[] = [];
    private historyIndex: number = -1;
    private historySnapshot: string | null = null;
    private isInteracting: boolean = false;
    private currentActionModified: boolean = false;
    private lastEmittedZoom: number = 0;

    constructor() {
        super('MapMakerScene');
    }

    create() {
        this.cameras.main.setBackgroundColor('#121212');
        this.targetZoom = this.cameras.main.zoom;
        this.targetScroll.set(this.cameras.main.scrollX, this.cameras.main.scrollY);
        
        // groups
        this.tileGroup = this.add.group();
        this.cursorGroup = this.add.group();
        this.selectionFloatingGroup = this.add.group();
        this.gridGraphics = this.add.graphics();
        
        // dimming texture
        this.dimTexture = this.add.renderTexture(0, 0, 800, 600);
        this.dimTexture.setDepth(150);
        this.dimTexture.setOrigin(0,0);
        
        if (!this.textures.exists('mm-eraser-brush')) {
            const g = this.make.graphics();
            g.fillStyle(0xffffff);
            g.fillRect(0,0,32,32);
            g.generateTexture('mm-eraser-brush', 32, 32);
            g.destroy();
        }

        this.selectionFloatingGroup.setDepth(151);

        this.highlightGraphics = this.add.graphics();
        this.highlightGraphics.setDepth(100);

        // initialize UI
        this.ui = new MapMakerUI((state) => this.onUIStateChange(state));
        window.dispatchEvent(new CustomEvent('mapmaker:open'));
        
        // input events
        this.input.on('pointerdown', this.onPointerDown, this);
        this.input.on('pointerup', this.onPointerUp, this);
        this.input.on('pointermove', this.onPointerMove, this);
        this.input.on('wheel', this.onWheel, this);
        
        // prevent context menu
        this.input.mouse?.disableContextMenu();
        this.input.setDefaultCursor('crosshair');

        this.drawGrid();

        // listen for global events
        window.addEventListener('mapmaker:open', () => {
            this.scene.wake();
            this.scene.bringToTop();
            if (this.scene.get('GameScene')) {
                this.scene.get('GameScene').scene.pause();
            }
        });

        window.addEventListener('mapmaker:close', () => {
            this.scene.sleep();
            if (this.scene.get('GameScene')) {
                this.scene.get('GameScene').scene.resume();
            }
        });

        window.addEventListener('mapmaker:save', () => {
            this.saveMap();
        });
        
        window.addEventListener('mapmaker:undo', () => this.undo());
        window.addEventListener('mapmaker:redo', () => this.redo());
        window.addEventListener('mapmaker:zoom-fit', () => this.zoomFit());

        window.addEventListener('mapmaker:copy', () => this.copySelection());
        window.addEventListener('mapmaker:paste', () => this.pasteSelection());
        window.addEventListener('mapmaker:stencil', () => this.saveSelectionAsStencil());
        window.addEventListener('mapmaker:layershift', () => this.shiftSelectionLayer());
        window.addEventListener('mapmaker:cancel-selection', () => this.clearSelection());

        window.addEventListener('mapmaker:ui-enter', () => {
            this.highlightGraphics.clear();
        });

        window.addEventListener('mapmaker:regen-noise', () => {
            this.noiseSeed = Math.random() * 1000;
            if (this.input.activePointer) {
                this.updateCursor(this.input.activePointer);
            }
        });

        window.addEventListener('mapmaker:start-test', ((e: CustomEvent) => {
            const { mapId } = e.detail;
            this.scene.launch('MapTesterScene', { mapId });
            this.scene.sleep();
            if (this.ui) this.ui.hide();
        }) as EventListener);

        this.input.on('gameout', () => {
            this.highlightGraphics.clear();
        });
    }

    private pushHistoryState() {
        if (!this.mapData) return;
        
        // create snapshot
        const snapshot = JSON.stringify(this.mapData.layers);
        
        // if snapshot is identical to current head, do nothing
        if (this.historyIndex >= 0 && this.historyStack[this.historyIndex] === snapshot) return;
        
        // slice stack if we are in the middle history
        if (this.historyIndex < this.historyStack.length - 1) {
            this.historyStack = this.historyStack.slice(0, this.historyIndex + 1);
        }
        
        this.historyStack.push(snapshot);
        this.historyIndex++;
        
        // basic limits
        if (this.historyStack.length > 50) {
            this.historyStack.shift();
            this.historyIndex--;
        }

        // local persist
        try {
            localStorage.setItem(`mm_history_${this.mapData._id}`, JSON.stringify({
                stack: this.historyStack,
                index: this.historyIndex
            }));
        } catch(e) {}
        
        this.emitHistoryChange();
    }

    private loadHistory() {
        if (!this.mapData) return;
        const stored = localStorage.getItem(`mm_history_${this.mapData._id}`);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed.stack && Array.isArray(parsed.stack)) {
                    this.historyStack = parsed.stack;
                    this.historyIndex = parsed.index;
                }
            } catch(e) {}
        }
        
        if (this.historyStack.length === 0) {
            this.pushHistoryState();
        }
        this.emitHistoryChange();
    }

    private emitHistoryChange() {
        window.dispatchEvent(new CustomEvent('mapmaker:history-avail', {
            detail: {
                canUndo: this.historyIndex > 0,
                canRedo: this.historyIndex < this.historyStack.length - 1
            }
        }));
    }

    private undo() {
        if (this.mapData?.state !== MapState.DRAFT) return;
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.restoreHistoryState();
        }
    }

    private redo() {
        if (this.mapData?.state !== MapState.DRAFT) return;
        if (this.historyIndex < this.historyStack.length - 1) {
            this.historyIndex++;
            this.restoreHistoryState();
        }
    }

    private restoreHistoryState() {
        if (!this.mapData) return;
        const snapshot = this.historyStack[this.historyIndex];
        if (snapshot) {
            this.mapData.layers = JSON.parse(snapshot);
            this.renderMap();
            this.updatePreviewsAll();
            localStorage.setItem(`mm_history_${this.mapData._id}`, JSON.stringify({
                stack: this.historyStack,
                index: this.historyIndex
            }));
            this.emitHistoryChange();
            this.hasUnsavedChanges = true;
            this.lastEditTime = Date.now();
        }
    }

    private zoomFit() {
        if (!this.mapData) return;
        
        const pad = 100;
        const mapW = this.mapData.width * 32;
        const mapH = this.mapData.height * 32;
        
        const screenW = this.cameras.main.width;
        const screenH = this.cameras.main.height;
        
        const scaleX = (screenW - pad) / mapW;
        const scaleY = (screenH - pad) / mapH;
        
        this.targetZoom = Math.min(scaleX, scaleY);

        this.targetScroll.x = (mapW / 2) - (screenW / 2);
        this.targetScroll.y = (mapH / 2) - (screenH / 2);
    }


    private onUIStateChange(state: any) {
        if (state.library) {
            this.availableTiles = state.library;
            this.loadTileTextures(state.library);
        }
        
        if (state.clipboard) {
            (this as any)._clipboard = state.clipboard;
        }

        if (state.currentMap && (!this.mapData || this.mapData._id !== state.currentMap._id)) {
            this.loadMap(state.currentMap);
        } 
        else if (state.currentMap && this.mapData && this.mapData.state !== state.currentMap.state) {
            this.mapData.state = state.currentMap.state;
            this.updateCursor(this.input.activePointer); 
        }

        this.selectedTool = state.selectedTool;
        this.selectedLayer = state.selectedLayer;
        this.selectedTileId = state.selectedTileId;
        this.brushRadius = state.radius;
        this.diffusion = state.diffusion;
        this.shape = state.shape;
        
        if (state.layerVisibility) {
            this.layerVisibility = state.layerVisibility;
            this.renderMap();
        }
        if (state.layerLocked) {
            this.layerLocked = state.layerLocked;
        }
        if (state.palette && this.mapData) {
            this.mapData.palette = state.palette;
        }
    }

    private loadMap(map: IMap) {
        this.mapData = map;
        this.hasUnsavedChanges = false;
        this.loadHistory();
        
        this.tileGroup.clear(true, true);
        
        // resize dim texture
        if (this.dimTexture) {
            this.dimTexture.resize(map.width * 32, map.height * 32);
            this.dimTexture.setOrigin(0,0);
            this.dimTexture.clear();
        }

        if (this.availableTiles.length > 0) {
             this.loadTileTextures(this.availableTiles);
        }

        this.renderMap();
        this.updatePreviewsAll();
        
        this.cameras.main.centerOn(map.width * 16, map.height * 16);
        this.targetZoom = this.cameras.main.zoom;
        this.targetScroll.set(this.cameras.main.scrollX, this.cameras.main.scrollY);
    }

    private updatePreviewsAll() {
        Object.values(MapLayer).forEach(l => this.updateLayerPreview(l));
    }

    private updateLayerPreview(layer: MapLayer) {
        if (!this.mapData) return;
        const layerData = this.mapData.layers[layer];
        if (!layerData) return;

        // create texture
        const width = this.mapData.width * 32;
        const height = this.mapData.height * 32;
        const maxDim = 128;
        const scale = Math.min(maxDim / width, maxDim / height);
        const rtW = Math.max(1, width * scale);
        const rtH = Math.max(1, height * scale);

        const rt = this.make.renderTexture({ width: rtW, height: rtH }, false);
        
        const sprites: Phaser.GameObjects.Image[] = [];
        
        Object.entries(layerData).forEach(([coord, tileId]) => {
            const [gx, gy] = coord.split(',').map(Number);
            if (this.textures.exists(tileId)) {
                const tempSprite = this.make.image({ key: tileId }, false);
                tempSprite.setOrigin(0, 0);
                tempSprite.setScale(scale);
                tempSprite.setPosition(gx * 32 * scale, gy * 32 * scale);
                sprites.push(tempSprite);
            }
        });

        if (sprites.length > 0) {
            rt.draw(sprites);
            sprites.forEach(s => s.destroy());
            
            rt.snapshot((img: any) => {
                window.dispatchEvent(new CustomEvent('mapmaker:preview', {
                    detail: { layer, image: img.src }
                }));
                rt.destroy();
            });
        } else {
            window.dispatchEvent(new CustomEvent('mapmaker:preview', {
                detail: { layer, image: '' }
            }));
            rt.destroy();
        }
    }

    private loadTileTextures(tiles: (ITile | ITileGroup)[]) {
        let loadCount = 0;
        tiles.forEach(tile => {
            if (!this.textures.exists(tile.id)) {
                const imageUrl = 'imageUrl' in tile ? tile.imageUrl : (tile as ITileGroup).previewUrl;

                if (imageUrl) {
                    loadCount++;
                    this.load.image(tile.id, Config.getImageUrl(imageUrl));
                }
            }
        });
        
        if (loadCount > 0) {
            this.load.once('complete', () => {
                this.renderMap();
                this.updatePreviewsAll();
            });
            this.load.start();
        }
    }

    private renderMap() {
        if (!this.mapData) return;
        
        this.tileGroup.clear(true, true);

        const layers = [MapLayer.BACKGROUND, MapLayer.GROUND, MapLayer.WALL, MapLayer.DECO, MapLayer.OBJECT];
        
        layers.forEach(layerKey => {
            if (!this.layerVisibility[layerKey]) return;

            const layerData = this.mapData!.layers[layerKey];
            if (!layerData) return;

            Object.entries(layerData).forEach(([coord, tileId]) => {
                const [gx, gy] = coord.split(',').map(Number);
                if (this.textures.exists(tileId)) {
                    const sprite = this.add.image(gx * 32 + 16, gy * 32 + 16, tileId);
                    sprite.setDisplaySize(32, 32);
                    this.tileGroup.add(sprite);
                }
            });
        });

        this.drawGrid();
    }

    private drawGrid() {
        if (!this.mapData) return;
        
        this.gridGraphics.clear();

        this.gridGraphics.fillStyle(0x1a1a1a);
        this.gridGraphics.fillRect(0, 0, this.mapData.width * 32, this.mapData.height * 32);

        const thickness = Math.max(1, 1 / this.cameras.main.zoom);

        this.gridGraphics.lineStyle(thickness, 0x555555, 0.5);

        for (let x = 0; x <= this.mapData.width; x++) {
            this.gridGraphics.moveTo(x * 32, 0);
            this.gridGraphics.lineTo(x * 32, this.mapData.height * 32);
        }
        for (let y = 0; y <= this.mapData.height; y++) {
            this.gridGraphics.moveTo(0, y * 32);
            this.gridGraphics.lineTo(this.mapData.width * 32, y * 32);
        }
        
        this.gridGraphics.lineStyle(thickness * 2, 0x3a7bd5, 1);
        this.gridGraphics.strokeRect(0, 0, this.mapData.width * 32, this.mapData.height * 32);
    }

    private onPointerDown(pointer: Phaser.Input.Pointer) {
        this.lastFootprint.clear();
        this.currentActionModified = false;
        
        this.highlightGraphics.clear(); 
        
        if (pointer.button === 2 || pointer.button === 1 || (pointer.button === 0 && this.input.keyboard?.checkDown(this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE)))) {
            this.isDragging = true;
            this.dragStart.set(pointer.x, pointer.y);
            this.cameraStart.set(this.cameras.main.scrollX, this.cameras.main.scrollY);
            this.input.setDefaultCursor('grabbing');
            return;
        }

        if (this.mapData?.state !== MapState.DRAFT) return;
        if (this.layerLocked[this.selectedLayer]) return;
        if (!this.layerVisibility[this.selectedLayer]) return;

        if (pointer.button === 0 && this.mapData) {
            if (this.selectedTool === 'select') {
                const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
                const cx = Math.floor(worldPoint.x / 32);
                const cy = Math.floor(worldPoint.y / 32);
                const key = `${cx},${cy}`;

                if (this.selection.has(key)) {
                    this.selectionMoving = true;
                    this.selectionMoveOffset = { x: 0, y: 0 };
                    this.dragStart.set(cx, cy);
                    
                    if (this.selectionFloatingGroup.getLength() === 0) {
                         this.updateSelectionVisuals();
                    }
                } else {
                    this.clearSelection();
                    this.isSelecting = true;
                    this.selectionStart = { x: cx, y: cy };
                    this.selection.add(key);
                    this.updateSelectionVisuals();
                }
            } else if (this.selectedTool === 'fill') {
                this.fillTile(pointer);
            } else {
                this.paintTile(pointer);
            }
        }
    }

    private onPointerUp(pointer: Phaser.Input.Pointer) {
        if (this.isSelecting) {
            this.isSelecting = false;
            window.dispatchEvent(new CustomEvent('mapmaker:selection-changed', { detail: { hasSelection: this.selection.size > 0 } }));
            return;
        }

        if (this.selectionMoving) {
            this.selectionMoving = false;
            this.finalizeSelectionMove();
            return;
        }

        if (pointer.button === 2 && this.isDragging) {
            const dist = Phaser.Math.Distance.Between(pointer.x, pointer.y, this.dragStart.x, this.dragStart.y);
            if (dist < 5 && this.mapData?.state === MapState.DRAFT && !this.layerLocked[this.selectedLayer] && this.layerVisibility[this.selectedLayer]) {
                const oldTool = this.selectedTool;
                this.selectedTool = 'erase';
                const oldRadius = this.brushRadius;
                this.brushRadius = 1;
                this.paintTile(pointer);
                this.selectedTool = oldTool;
                this.brushRadius = oldRadius;
            }
        }

        this.isDragging = false;
        this.input.setDefaultCursor('crosshair');
        this.lastFootprint.clear();
        
        if (this.hasUnsavedChanges) {
            this.updateLayerPreview(this.selectedLayer);
        }

        if (this.currentActionModified) {
            this.pushHistoryState();
            this.currentActionModified = false;
        }
    }

    private onPointerMove(pointer: Phaser.Input.Pointer) {
        if (this.isDragging) {
            const dx = (pointer.x - this.dragStart.x) / this.cameras.main.zoom;
            const dy = (pointer.y - this.dragStart.y) / this.cameras.main.zoom;
            
            this.targetScroll.x = this.cameraStart.x - dx;
            this.targetScroll.y = this.cameraStart.y - dy;
            
            this.cameras.main.scrollX = this.targetScroll.x;
            this.cameras.main.scrollY = this.targetScroll.y;
        } else if (this.selectionMoving) {
            const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
            const cx = Math.floor(worldPoint.x / 32);
            const cy = Math.floor(worldPoint.y / 32);
            
            const dx = cx - this.dragStart.x;
            const dy = cy - this.dragStart.y;
            
            if (dx !== this.selectionMoveOffset.x || dy !== this.selectionMoveOffset.y) {
                this.selectionMoveOffset = { x: dx, y: dy };
                this.updateSelectionVisuals();
            }
        } else if (this.isSelecting) {
            const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
            const cx = Math.floor(worldPoint.x / 32);
            const cy = Math.floor(worldPoint.y / 32);
            
            if (this.shape === 'freeform') {
                 this.selection.add(`${cx},${cy}`);
                 this.updateSelectionVisuals();
            } else {
                 // square
                 if (this.selectionStart) {
                     this.selection.clear();
                     const minX = Math.min(this.selectionStart.x, cx);
                     const maxX = Math.max(this.selectionStart.x, cx);
                     const minY = Math.min(this.selectionStart.y, cy);
                     const maxY = Math.max(this.selectionStart.y, cy);
                     
                     for(let x=minX; x<=maxX; x++) {
                         for(let y=minY; y<=maxY; y++) {
                             this.selection.add(`${x},${y}`);
                         }
                     }
                     this.updateSelectionVisuals();
                 }
            }
        } else {
            if(!this.isSelecting && !this.selectionMoving) {
                this.updateCursor(pointer);
            } else {
                this.highlightGraphics.clear();
            }
            
            if (pointer.isDown && this.selectedTool !== 'fill' && this.selectedTool !== 'select' && this.mapData?.state === MapState.DRAFT && !this.layerLocked[this.selectedLayer] && this.layerVisibility[this.selectedLayer]) {
                 this.paintTile(pointer);
            }
        }
    }

    private onWheel(pointer: Phaser.Input.Pointer, gameObjects: any, deltaX: number, deltaY: number, deltaZ: number) {
        const zoomFactor = 0.1;
        const direction = Math.sign(-deltaY);
        
        const currentZoom = this.targetZoom;
        const newZoom = Phaser.Math.Clamp(currentZoom * (1 + direction * zoomFactor), 0.1, 5);
        
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const centerX = this.cameras.main.width * 0.5;
        const centerY = this.cameras.main.height * 0.5;
        
        this.targetZoom = newZoom;
        this.targetScroll.x = worldPoint.x - (pointer.x - centerX) / newZoom - centerX;
        this.targetScroll.y = worldPoint.y - (pointer.y - centerY) / newZoom - centerY;
    }

    private getGroup(id: string): ITileGroup | undefined {
        const item = this.availableTiles.find(t => t.id === id);
        return (item && 'tiles' in item) ? item as ITileGroup : undefined;
    }

    private clearSelection() {
        this.selection.clear();
        this.selectionStart = null;
        this.selectionMoveOffset = { x: 0, y: 0 };
        if(this.dimTexture) this.dimTexture.clear();
        this.selectionFloatingGroup.clear(true, true);
        window.dispatchEvent(new CustomEvent('mapmaker:selection-changed', { detail: { hasSelection: false } }));
    }

    private updateSelectionVisuals() {
        this.dimTexture.clear();
        this.selectionFloatingGroup.clear(true, true);
        this.highlightGraphics.clear();
        
        if (this.selection.size === 0 && !this.isSelecting) return;

        this.dimTexture.fill(0x000000, 0.6);

        const eraser = this.make.image({ key: 'mm-eraser-brush' }, false);
        eraser.setOrigin(0,0);
        
        if (this.isPasteMode) {
             this.pastePreview.forEach(t => {
                 const x = (t.x + this.selectionMoveOffset.x) * 32;
                 const y = (t.y + this.selectionMoveOffset.y) * 32;
                 this.dimTexture.erase(eraser, x, y);
             });
        } else {
             this.selection.forEach(key => {
                 const [sx, sy] = key.split(',').map(Number);
                 const x = (sx + this.selectionMoveOffset.x) * 32;
                 const y = (sy + this.selectionMoveOffset.y) * 32;
                 this.dimTexture.erase(eraser, x, y);
             });
        }
        
        eraser.destroy();

        if (this.isPasteMode) {
             this.pastePreview.forEach(t => {
                const tx = t.x + (this.selectionMoveOffset?.x || 0);
                const ty = t.y + (this.selectionMoveOffset?.y || 0);
                if (this.textures.exists(t.id)) {
                    const img = this.add.image(tx * 32 + 16, ty * 32 + 16, t.id);
                    img.setDisplaySize(32, 32);
                    this.selectionFloatingGroup.add(img);
                }
             });
        } else if (this.mapData && this.selectedLayer) {
            const layer = this.mapData.layers[this.selectedLayer];
            this.selection.forEach(key => {
                const [x, y] = key.split(',').map(Number);
                const tileId = layer[key];
                
                const drawX = (x + this.selectionMoveOffset.x);
                const drawY = (y + this.selectionMoveOffset.y);

                if (tileId && this.textures.exists(tileId)) {
                    const img = this.add.image(drawX * 32 + 16, drawY * 32 + 16, tileId);
                    img.setDisplaySize(32, 32);
                    img.setDepth(151);
                    this.selectionFloatingGroup.add(img);
                }
            });
        }
        this.selectionFloatingGroup.setDepth(151);
    }
    
    private finalizeSelectionMove() {
        if (!this.mapData || !this.selectedLayer) return;

        const layer = this.mapData.layers[this.selectedLayer];
        const newSelection = new Set<string>();

        if (this.isPasteMode) {
            this.pastePreview.forEach(t => {
                const tx = t.x + this.selectionMoveOffset.x;
                const ty = t.y + this.selectionMoveOffset.y;
                if (tx >= 0 && ty >= 0 && tx < this.mapData!.width && ty < this.mapData!.height) {
                    layer[`${tx},${ty}`] = t.id;
                    newSelection.add(`${tx},${ty}`);
                }
            });
            this.isPasteMode = false;
        } else {
            // Normal move
            if (this.selectionMoveOffset.x === 0 && this.selectionMoveOffset.y === 0) return;
            
            const moves: {x:number, y:number, id:string}[] = [];
            // collect
            this.selection.forEach(key => {
                const [x, y] = key.split(',').map(Number);
                if (layer[key]) {
                    moves.push({ x: x + this.selectionMoveOffset.x, y: y + this.selectionMoveOffset.y, id: layer[key] });
                    delete layer[key];
                }
            });
            // apply
            moves.forEach(m => {
                if (m.x >= 0 && m.y >= 0 && m.x < this.mapData!.width && m.y < this.mapData!.height) {
                    layer[`${m.x},${m.y}`] = m.id;
                    newSelection.add(`${m.x},${m.y}`);
                }
            });
        }

        this.selection = newSelection;
        this.selectionMoveOffset = { x: 0, y: 0 };
        this.hasUnsavedChanges = true;
        this.currentActionModified = true;
        this.renderMap();
        this.pushHistoryState();
        this.updateSelectionVisuals();
    }
    
    private pasteSelection() {
        if (this.layerLocked[this.selectedLayer] || !this.layerVisibility[this.selectedLayer]) return;

        const clipboard = (this as any)._clipboard;
        if (!clipboard || clipboard.length === 0) return;

        const center = this.cameras.main.midPoint;
        const cx = Math.floor(center.x / 32);
        const cy = Math.floor(center.y / 32);
        
        this.isPasteMode = true;
        this.pastePreview = clipboard.map((c: any) => ({ ...c, x: cx + c.x, y: cy + c.y }));
        
        this.selection.clear();
        this.pastePreview.forEach(p => this.selection.add(`${p.x},${p.y}`));
        
        this.selectionMoveOffset = { x: 0, y: 0 };
        this.selectedTool = 'select';
        
        window.dispatchEvent(new CustomEvent('mapmaker:selection-changed', { detail: { hasSelection: true } }));
        
        this.updateSelectionVisuals();
    }

    private saveSelectionAsStencil() {
        if (this.selection.size === 0) return;
        const name = prompt("Stencil Name:");
        if (!name) return;

        const tiles: {x:number, y:number, tileId:string}[] = [];
        const layer = this.mapData!.layers[this.selectedLayer];
        
        let minX = Infinity, minY = Infinity;
        this.selection.forEach(key => {
             const [x,y] = key.split(',').map(Number);
             if (layer[key]) {
                 minX = Math.min(minX, x);
                 minY = Math.min(minY, y);
             }
        });

        this.selection.forEach(key => {
             const [x,y] = key.split(',').map(Number);
             if (layer[key]) {
                 tiles.push({ x: x - minX, y: y - minY, tileId: layer[key] });
             }
        });

        if (tiles.length === 0) return;

        const stencil = {
            name,
            itemType: 'group',
            tiles,
            previewUrl: ''
        };

        fetch(Config.getApiUrl('/tile-groups'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(stencil)
        }).then(res => res.json()).then(newGroup => {
             newGroup.itemType = 'group';
             alert('Stencil saved to library');
        });
    }

    private shiftSelectionLayer() {
        if (this.layerLocked[this.selectedLayer] || !this.layerVisibility[this.selectedLayer]) return;

        const targetLayer = prompt("Target Layer (background, ground, wall, deco, object):");
        if (!targetLayer || !Object.values(MapLayer).includes(targetLayer as any)) return;
        
        const oldL = this.mapData!.layers[this.selectedLayer];
        const newL = this.mapData!.layers[targetLayer as MapLayer];
        
        const newSelection = new Set<string>();

        this.selection.forEach(key => {
            if (oldL[key]) {
                const id = oldL[key];
                delete oldL[key];
                newL[key] = id;
                newSelection.add(key);
            }
        });
        
        this.selectedLayer = targetLayer as MapLayer;
        this.ui['state'].selectedLayer = this.selectedLayer;
        this.renderMap();
        this.pushHistoryState();
        this.currentActionModified = true;
        this.updateSelectionVisuals();
    }

    private updateCursor(pointer: Phaser.Input.Pointer) {
        if (!this.mapData) return;
        
        if (this.mapData.state !== MapState.DRAFT && !this.isDragging) {
            this.input.setDefaultCursor('not-allowed');
            this.highlightGraphics.clear();
            this.cursorGroup.getChildren().forEach((c: any) => c.setVisible(false));
            return;
        } else if ((this.layerLocked[this.selectedLayer] || !this.layerVisibility[this.selectedLayer]) && !this.isDragging) {
            this.input.setDefaultCursor('not-allowed');
            this.highlightGraphics.clear();
            this.cursorGroup.getChildren().forEach((c: any) => c.setVisible(false));
            return;
        } else if (!this.isDragging) {
            this.input.setDefaultCursor('crosshair');
        }

        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const cx = Math.floor(worldPoint.x / 32);
        const cy = Math.floor(worldPoint.y / 32);

        this.highlightGraphics.clear();
        this.cursorGroup.getChildren().forEach((c: any) => c.setVisible(false));
        
        // check if selected is a group
        const group = this.selectedTileId ? this.getGroup(this.selectedTileId) : undefined;

        if (group && this.selectedTool === 'place') {
            // group preview
            const img = this.cursorGroup.get(cx * 32, cy * 32, this.selectedTileId);
            if (img) {
                // determine group dimensions
                let maxX = 0, maxY = 0;
                group.tiles.forEach(t => {
                    maxX = Math.max(maxX, t.x);
                    maxY = Math.max(maxY, t.y);
                });
                const groupW = maxX + 1;
                const groupH = maxY + 1;
                const w = groupW * 32;
                const h = groupH * 32;

                const offX = Math.floor(groupW / 2);
                const offY = Math.floor(groupH / 2);
                
                const originX = (cx - offX) * 32;
                const originY = (cy - offY) * 32;
                
                img.setOrigin(0, 0);
                img.setVisible(true);
                img.setTexture(this.selectedTileId);
                img.setDisplaySize(w, h);
                img.setAlpha(0.6);
                img.setDepth(101);
                
                img.x = originX;
                img.y = originY;
            }
            return;
        }

        if (this.selectedTool === 'fill') {
            const floodCoords = this.getFloodFillCoords(cx, cy);
            this.highlightGraphics.fillStyle(0x808080, 0.5);
            floodCoords.forEach(coord => {
                const [fx, fy] = coord.split(',').map(Number);
                this.highlightGraphics.fillRect(fx * 32, fy * 32, 32, 32);
            });
            return;
        }

        const range = Math.floor(this.brushRadius / 2);
        
        for (let x = cx - range; x <= cx + range; x++) {
            for (let y = cy - range; y <= cy + range; y++) {
                if (this.shape.includes('circle')) {
                    const dist = Math.sqrt(Math.pow(x - cx, 2) + Math.pow(y - cy, 2));
                    if (dist > this.brushRadius / 2) continue;
                }

                let include = true;
                if (this.shape.startsWith('perlin')) {
                    const freq = Phaser.Math.Linear(0.5, 0.05, this.diffusion / 100);
                    const n = this.noise(x * freq, y * freq);
                    if (n < 0.5) include = false;
                }
                
                if (include) {
                    if (this.selectedTool === 'place' && this.selectedTileId) {
                        const img = this.cursorGroup.get(x * 32 + 16, y * 32 + 16, this.selectedTileId);
                        if (img) {
                            img.setOrigin(0.5, 0.5);
                            img.setVisible(true);
                            img.setTexture(this.selectedTileId);
                            img.setDisplaySize(32, 32);
                            img.setAlpha(0.6);
                            img.setDepth(101);
                        }
                    } else {
                        this.highlightGraphics.fillStyle(this.selectedTool === 'erase' ? 0xff0000 : 0x00ff00, 0.3);
                        this.highlightGraphics.fillRect(x * 32, y * 32, 32, 32);
                    }
                }
            }
        }
    }

    private getFloodFillCoords(startX: number, startY: number): Set<string> {
        const coords = new Set<string>();
        if (!this.mapData || !this.selectedLayer) return coords;
        if (startX < 0 || startY < 0 || startX >= this.mapData.width || startY >= this.mapData.height) return coords;

        const layer = this.mapData.layers[this.selectedLayer];
        const targetId = layer[`${startX},${startY}`];
        
        const queue = [{ x: startX, y: startY }];
        const visited = new Set<string>();
        let processed = 0;
        const maxProcess = 4000;

        while (queue.length > 0 && processed < maxProcess) {
            const { x, y } = queue.shift()!;
            const key = `${x},${y}`;

            if (visited.has(key)) continue;
            visited.add(key);
            processed++;

            if (layer[key] !== targetId) continue;

            coords.add(key);

            const neighbors = [
                { x: x + 1, y }, { x: x - 1, y },
                { x, y: y + 1 }, { x, y: y - 1 }
            ];

            for (const n of neighbors) {
                if (n.x >= 0 && n.y >= 0 && n.x < this.mapData.width && n.y < this.mapData.height) {
                    queue.push(n);
                }
            }
        }
        return coords;
    }

    private noise(x: number, y: number) {
        const i = Math.floor(x);
        const j = Math.floor(y);
        const u = x - i;
        const v = y - j;
        
        // random hash
        const hash = (i: number, j: number) => {
            const sin = Math.sin((i + this.noiseSeed) * 12.9898 + (j + this.noiseSeed) * 78.233) * 43758.5453;
            return sin - Math.floor(sin);
        };

        // bilinear interpolation
        const a = hash(i, j);
        const b = hash(i + 1, j);
        const c = hash(i, j + 1);
        const d = hash(i + 1, j + 1);

        const u2 = u * u * (3 - 2 * u); // smoothstep
        const v2 = v * v * (3 - 2 * v);

        return a + (b - a) * u2 + (c - a) * v2 + (a - b - c + d) * u2 * v2;
    }

    private paintTile(pointer: Phaser.Input.Pointer) {
        if (!this.mapData || !this.selectedLayer) return;
        this.lastEditTime = Date.now();

        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const cx = Math.floor(worldPoint.x / 32);
        const cy = Math.floor(worldPoint.y / 32);

        // multitile paint logic
        const group = this.selectedTileId ? this.getGroup(this.selectedTileId) : undefined;
        if (group && this.selectedTool === 'place') {
            const layer = this.mapData.layers[this.selectedLayer];
            let changed = false;

            let maxX = 0, maxY = 0;
            group.tiles.forEach(t => { maxX = Math.max(maxX, t.x); maxY = Math.max(maxY, t.y); });
            const groupW = maxX + 1;
            const groupH = maxY + 1;
            
            const offX = Math.floor(groupW / 2);
            const offY = Math.floor(groupH / 2);

            group.tiles.forEach(tile => {
                const tx = cx - offX + tile.x;
                const ty = cy - offY + tile.y;
                
                if (tx >= 0 && ty >= 0 && tx < this.mapData!.width && ty < this.mapData!.height) {
                    const coord = `${tx},${ty}`;
                    if (layer[coord] !== tile.tileId) {
                        layer[coord] = tile.tileId;
                        changed = true;
                    }
                }
            });

            if (changed) {
                this.hasUnsavedChanges = true;
                this.currentActionModified = true;
                this.renderMap();
            }
            return;
        }

        const range = Math.floor(this.brushRadius / 2);
        const currentFootprint = new Set<string>();

        for (let x = cx - range; x <= cx + range; x++) {
            for (let y = cy - range; y <= cy + range; y++) {
                if (x < 0 || y < 0 || x >= this.mapData.width || y >= this.mapData.height) continue;
                
                if (this.shape.includes('circle')) {
                    const dist = Math.sqrt(Math.pow(x - cx, 2) + Math.pow(y - cy, 2));
                    if (dist > this.brushRadius / 2) continue;
                }

                if (this.shape.startsWith('perlin')) {
                    const freq = Phaser.Math.Linear(0.5, 0.05, this.diffusion / 100);
                    const n = this.noise(x * freq, y * freq);
                    if (n < 0.5) continue; 
                }

                const coord = `${x},${y}`;
                currentFootprint.add(coord);

                if (this.lastFootprint.has(coord)) continue;

                if (!this.shape.startsWith('perlin') && this.diffusion < 100) {
                    if (Math.random() * 100 > this.diffusion) continue;
                }

                const layer = this.mapData.layers[this.selectedLayer];
                
                if (this.selectedTool === 'erase') {
                    if (layer[coord]) {
                        delete layer[coord];
                        this.hasUnsavedChanges = true;
                        this.currentActionModified = true;
                    }
                } else if (this.selectedTool === 'place' && this.selectedTileId) {
                    if (layer[coord] !== this.selectedTileId) {
                        layer[coord] = this.selectedTileId;
                        this.hasUnsavedChanges = true;
                        this.currentActionModified = true;
                    }
                }
            }
        }
        
        this.lastFootprint = currentFootprint;

        if (this.hasUnsavedChanges) {
             this.renderMap();
        }
    }

    private fillTile(pointer: Phaser.Input.Pointer) {
        if (!this.mapData || !this.selectedLayer || !this.selectedTileId) return;
        this.lastEditTime = Date.now();

        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const startX = Math.floor(worldPoint.x / 32);
        const startY = Math.floor(worldPoint.y / 32);

        if (startX < 0 || startY < 0 || startX >= this.mapData.width || startY >= this.mapData.height) return;

        const layer = this.mapData.layers[this.selectedLayer];
        const targetId = layer[`${startX},${startY}`];

        if (targetId === this.selectedTileId) return;

        const queue = [{ x: startX, y: startY }];
        const visited = new Set<string>();
        
        let processed = 0;
        const maxProcess = 4000;

        while (queue.length > 0 && processed < maxProcess) {
            const { x, y } = queue.shift()!;
            const key = `${x},${y}`;

            if (visited.has(key)) continue;
            visited.add(key);
            processed++;

            if (layer[key] !== targetId) continue;

            if (this.diffusion >= 100 || Math.random() * 100 <= this.diffusion) {
                layer[key] = this.selectedTileId;
                this.hasUnsavedChanges = true;
                this.currentActionModified = true;
            }

            const neighbors = [
                { x: x + 1, y }, { x: x - 1, y },
                { x, y: y + 1 }, { x, y: y - 1 }
            ];

            for (const n of neighbors) {
                if (n.x >= 0 && n.y >= 0 && n.x < this.mapData.width && n.y < this.mapData.height) {
                    queue.push(n);
                }
            }
        }

        this.renderMap();
        this.hasUnsavedChanges = true;
    }

    update(time: number, delta: number) {
        const lerpFactor = 0.15;
        
        this.cameras.main.zoom = Phaser.Math.Linear(this.cameras.main.zoom, this.targetZoom, lerpFactor);
        this.cameras.main.scrollX = Phaser.Math.Linear(this.cameras.main.scrollX, this.targetScroll.x, lerpFactor);
        this.cameras.main.scrollY = Phaser.Math.Linear(this.cameras.main.scrollY, this.targetScroll.y, lerpFactor);

        if (Math.abs(this.cameras.main.zoom - this.lastZoom) > 0.05) {
            this.drawGrid();
            this.lastZoom = this.cameras.main.zoom;
        }

        if (Math.abs(this.cameras.main.zoom - this.lastEmittedZoom) > 0.001) {
             window.dispatchEvent(new CustomEvent('mapmaker:zoom-changed', {
                detail: { zoom: this.cameras.main.zoom }
             }));
             this.lastEmittedZoom = this.cameras.main.zoom;
        }

        const now = Date.now();
        if (this.hasUnsavedChanges && now > this.lastEditTime + 500) {
            this.saveMap();
        }
    }

    private serializePalette(list: any[]): any[] {
        if (!Array.isArray(list)) return [];
        return list.map(item => {
            if (item && item.itemType === 'folder') {
                return { ...item, items: this.serializePalette(item.items) };
            } else if (typeof item === 'object' && item.id) {
                return item.id;
            } else {
                return item;
            }
        });
    }

    private async saveMap() {
        if (!this.mapData || !this.mapData._id) return;
        
        console.log('Autosaving...');
        window.dispatchEvent(new CustomEvent('mapmaker:saving'));
        this.hasUnsavedChanges = false;
        
        try {
            const palette = this.serializePalette(this.mapData.palette || []);
            await fetch(Config.getApiUrl(`/maps/${this.mapData._id}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    layers: this.mapData.layers,
                    layerProperties: this.mapData.layerProperties,
                    palette: palette
                })
            });
            console.log('Saved.');
            window.dispatchEvent(new CustomEvent('mapmaker:saved'));
        } catch (e) {
            console.error('Save failed', e);
            this.hasUnsavedChanges = true;
        }
    }
}
