import { ITile, IMap, MapState, ITileGroup, DefaultLayers, IFolder, ILayer, SYSTEM_TILES } from '@cfwk/shared';
import { Config } from '../config';

// Removed IFolder definition since it is now imported from shared

/**
 * LEGACY MAP MAKER UI
 * This UI supports the deprecated custom map editor. It remains for legacy
 * content, while new maps are authored in Tiled (TMX) and rendered in Phaser.
 */
export class MapMakerUI {
    private root: HTMLElement;
    private state: {
        currentMap: IMap | null;
        library: (ITile | ITileGroup | IFolder)[];
        palette: (ITile | ITileGroup | IFolder)[];
        selectedTool: 'place' | 'erase' | 'fill';
        selectedLayer: string;
        selectedTileId: string | null;
        radius: number;
        diffusion: number;
        shape: 'square' | 'circle' | 'perlin-square' | 'perlin-circle';
        // layerVisibility/Locked now stored in layers themselves or managed dynamically
        layerPreviews: Record<string, string>;
        layerPanelCollapsed: boolean;
        libraryCollapsed: boolean;
        draggingItem: { item: ITile | ITileGroup | IFolder, sourceList: 'library' | 'palette' } | null;
        clipboard: any[] | null;
        hasSelection: boolean;
    };
    private onStateChange: ((state: any) => void) | null = null;
    private mapList: IMap[] = [];
    private lastSelectedTileId: string | null = null;
    private keybinds: Record<string, { type: 'layer' | 'tool' | 'tile' | 'shape', value: string }> = {};
    private hoveredTarget: { type: 'layer' | 'tool' | 'tile' | 'shape', value: string } | null = null;
    private zoomRAF: number | null = null;

    constructor(onStateChange: (state: any) => void) {
        this.onStateChange = onStateChange;
        this.root = document.createElement('div');
        this.root.id = 'map-maker-root';
        document.body.appendChild(this.root);

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/src/mapmaker/MapMaker.css'; 
        document.head.appendChild(link);

        this.state = {
            currentMap: null,
            library: [],
            palette: [],
            selectedTool: 'place',
            selectedLayer: DefaultLayers.GROUND,
            selectedTileId: null,
            radius: 1,
            diffusion: 100,
            shape: 'square',
            layerPreviews: {},
            layerPanelCollapsed: false,
            libraryCollapsed: false,
            draggingItem: null,
            clipboard: null,
            hasSelection: false
        };

        this.setupToast();
        this.loadKeybinds();
        
        // initialize static ui
        this.renderStaticUI();
        
        this.checkAuth();
        document.addEventListener('keydown', this.handleGlobalKeydown.bind(this));
        document.addEventListener('click', (e: any) => {
            if (!e.target.closest('.mm-context-menu')) this.closeContextMenu();
        });

        window.addEventListener('mapmaker:history-avail', (e: any) => {
            const { canUndo, canRedo } = e.detail;
            const undoBtn = this.root.querySelector('#mm-undo-btn') as HTMLButtonElement;
            const redoBtn = this.root.querySelector('#mm-redo-btn') as HTMLButtonElement;
            if (undoBtn) undoBtn.disabled = !canUndo;
            if (redoBtn) redoBtn.disabled = !canRedo;
            
            if (undoBtn) undoBtn.style.opacity = canUndo ? '1' : '0.3';
            if (redoBtn) redoBtn.style.opacity = canRedo ? '1' : '0.3';
        });

        window.addEventListener('mapmaker:selection-changed', (e: any) => {
            this.state.hasSelection = e.detail.hasSelection;
            this.updateFooterState();
        });

        window.addEventListener('mapmaker:clipboard-changed', (e: any) => {
            this.state.clipboard = e.detail.clipboard;
            this.updateFooterState();
        });

        window.addEventListener('mapmaker:zoom-changed', (e: any) => {
             const targetZoom = Math.round(e.detail.zoom * 100);
             const display = this.root.querySelector('#mm-zoom-display');
             
             if (display) {
                const currentText = display.textContent?.replace('%', '') || '100';
                let startZoom = parseInt(currentText, 10);
                if (isNaN(startZoom)) startZoom = 100;
                
                if (startZoom === targetZoom) return;

                if (this.zoomRAF) {
                    cancelAnimationFrame(this.zoomRAF);
                    this.zoomRAF = null;
                }

                const startTime = performance.now();
                const duration = 300; 
                
                const animate = (time: number) => {
                    const elapsed = time - startTime;
                    const progress = Math.min(elapsed / duration, 1);
                    const ease = 1 - Math.pow(1 - progress, 4); // quart ease
                    
                    const val = Math.round(startZoom + (targetZoom - startZoom) * ease);
                    display.textContent = `${val}%`;
                    
                    if (progress < 1) {
                         this.zoomRAF = requestAnimationFrame(animate);
                    } else {
                         display.textContent = `${targetZoom}%`;
                         this.zoomRAF = null;
                    }
                };
                
                this.zoomRAF = requestAnimationFrame(animate);
             }
        });
    }

    private renderStaticUI() {
        this.root.innerHTML = `
            <div id="mm-toast" class="mm-toast"></div>
            <div id="mm-save-indicator" class="mm-hidden">
                <div class="mm-save-dot"></div> Saving...
            </div>

            <!-- Sidebars Container -->
            <div id="mm-sidebars"></div>

            <!-- Footer Controls -->
            <div class="mm-footer-controls mm-pointer-events-auto">
               <div id="mm-selection-panel" class="mm-selection-panel" style="display: none;">
                   <button id="mm-sel-copy" class="mm-icon-btn" title="Copy (Ctrl+C)"><i class="fa-solid fa-copy"></i></button>
                   <button id="mm-sel-move-layer" class="mm-icon-btn" title="Shift Layer"><i class="fa-solid fa-layer-group"></i></button>
                   <button id="mm-sel-stencil" class="mm-icon-btn" title="Save as Stencil (Ctrl+S)"><i class="fa-solid fa-rubber-stamp"></i></button>
                   <div class="mm-divider-vert"></div>
                   <button id="mm-sel-cancel" class="mm-icon-btn mm-btn-success" title="Done"><i class="fa-solid fa-check"></i></button>
               </div>
               
               <div class="mm-footer-group">
                  <button id="mm-paste-btn" class="mm-icon-btn large" title="Paste (Ctrl+V)" style="display: none; margin-right: 0.5rem;"><i class="fa-solid fa-paste"></i></button>
                  <button id="mm-undo-btn" class="mm-icon-btn large" title="Undo (Ctrl+Z)" style="opacity: 0.3;" disabled><i class="fa-solid fa-rotate-left"></i></button>
                  <div class="mm-zoom-controls" id="mm-zoom-btn" title="Reset Zoom">
                     <span id="mm-zoom-display">100%</span>
                  </div>
                  <button id="mm-redo-btn" class="mm-icon-btn large" title="Redo (Ctrl+Y)" style="opacity: 0.3;" disabled><i class="fa-solid fa-rotate-right"></i></button>
               </div>
            </div>
        `;

        // bind statics
        this.bindFooterEvents();
        
        const undoBtn = this.root.querySelector('#mm-undo-btn');
        if (undoBtn) undoBtn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('mapmaker:undo')));
        
        const redoBtn = this.root.querySelector('#mm-redo-btn');
        if (redoBtn) redoBtn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('mapmaker:redo')));
        
        const zoomBtn = this.root.querySelector('#mm-zoom-btn');
        if (zoomBtn) zoomBtn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('mapmaker:zoom-fit')));
    }

    private bindFooterEvents() {
        const selCopy = this.root.querySelector('#mm-sel-copy');
        const selLayer = this.root.querySelector('#mm-sel-move-layer');
        const selStencil = this.root.querySelector('#mm-sel-stencil');
        const selCancel = this.root.querySelector('#mm-sel-cancel');
        const pasteBtn = this.root.querySelector('#mm-paste-btn');

        if(selCopy) selCopy.addEventListener('click', () => window.dispatchEvent(new CustomEvent('mapmaker:copy')));
        if(selLayer) selLayer.addEventListener('click', () => window.dispatchEvent(new CustomEvent('mapmaker:layershift')));
        if(selStencil) selStencil.addEventListener('click', () => window.dispatchEvent(new CustomEvent('mapmaker:stencil')));
        if(selCancel) selCancel.addEventListener('click', () => window.dispatchEvent(new CustomEvent('mapmaker:cancel-selection')));
        if(pasteBtn) pasteBtn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('mapmaker:paste')));
    }

    private closeContextMenu() {
        const menu = this.root.querySelector('.mm-context-menu');
        if (menu) menu.remove();
    }

    private loadKeybinds() {
        const stored = localStorage.getItem('mm_keybinds');
        if (stored) {
            try {
                this.keybinds = JSON.parse(stored);
            } catch (e) { console.error('Failed to load keybinds'); }
        }
    }

    private handleGlobalKeydown(e: KeyboardEvent) {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;

        if (e.ctrlKey && !e.altKey && !e.metaKey) {
            if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
                // ctrl+z
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('mapmaker:undo'));
                return;
            }
            if ((e.key.toLowerCase() === 'y' && !e.shiftKey) || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
                // ctrl+y or ctrl+shift+z
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('mapmaker:redo'));
                return;
            }
        }

        if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
        if (['Shift', 'Tab', 'Alt', 'Control', 'Meta', 'Enter', 'Escape', 'Backspace'].includes(e.key)) return;

        if (this.hoveredTarget) {
            this.attemptBind(e.key, this.hoveredTarget);
        } else {
            this.triggerBind(e.key);
        }
    }

    private attemptBind(key: string, target: { type: 'layer' | 'tool' | 'tile' | 'shape', value: string }) {
        // check conflict
        if (this.keybinds[key]) {
            const existing = this.keybinds[key];
            if (existing.type === target.type && existing.value === target.value) return; // Same bind

            this.showBindConflictModal(key, existing, target);
        } else {
            this.assignBind(key, target);
        }
    }

    private assignBind(key: string, target: { type: 'layer' | 'tool' | 'tile' | 'shape', value: string }) {
        // remove existing binds
        for (const k in this.keybinds) {
            const t = this.keybinds[k];
            if (t.type === target.type && t.value === target.value) {
                delete this.keybinds[k];
            }
        }
        
        this.keybinds[key] = target;
        localStorage.setItem('mm_keybinds', JSON.stringify(this.keybinds));
        this.renderEditor();
        this.showToast(`Bound "${key.toUpperCase()}" to ${target.value}`);
    }

    private triggerBind(key: string) {
        const target = this.keybinds[key];
        if (!target) return;

        if (target.type === 'layer') {
            const desiredLayer = target.value;
            // Validate layer exists
            if (this.state.currentMap && this.state.currentMap.layers.some(l => l.id === desiredLayer)) {
                this.state.selectedLayer = desiredLayer;
            }
        } else if (target.type === 'tool') {
            this.state.selectedTool = target.value as any;
            if (this.state.selectedTool === 'fill') {
                this.state.radius = 1;
                this.state.diffusion = 100;
            } else if (this.state.selectedTool === 'erase') {
                this.state.diffusion = 100;
            }
        } else if (target.type === 'tile') {
            this.state.selectedTileId = target.value;
            this.state.selectedTool = 'place';
        } else if (target.type === 'shape') {
            this.state.shape = target.value as any;
            if (this.state.shape.startsWith('perlin')) {
                this.state.diffusion = 40;
            }
        }
        
        this.renderEditor();
        this.updateState();
    }

    private showBindConflictModal(key: string, existing: any, target: any) {
        const modal = document.createElement('div');
        modal.className = 'mm-modal-overlay mm-pointer-events-auto';
        modal.innerHTML = `
            <div class="mm-card" style="max-width: 400px;">
                <h3>Keybind Conflict</h3>
                <p>Key <strong>"${key.toUpperCase()}"</strong> is already assigned to <strong>${existing.value}</strong> (${existing.type}).</p>
                <p>Do you want to reassign it to <strong>${target.value}</strong>?</p>
                <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
                    <button id="mm-bind-confirm" class="mm-btn">Move Keybind</button>
                    <button id="mm-bind-cancel" class="mm-btn mm-btn-secondary">Cancel</button>
                </div>
            </div>
        `;
        this.root.appendChild(modal);

        modal.querySelector('#mm-bind-cancel')?.addEventListener('click', () => modal.remove());
        modal.querySelector('#mm-bind-confirm')?.addEventListener('click', () => {
            this.assignBind(key, target);
            modal.remove();
        });
    }

    private updateFooterState() {
        const selPanel = this.root.querySelector('#mm-selection-panel') as HTMLElement;
        const pasteBtn = this.root.querySelector('#mm-paste-btn') as HTMLElement;
        
        if (selPanel) {
            selPanel.style.display = this.state.hasSelection ? 'flex' : 'none';
        }
        if (pasteBtn) {
            pasteBtn.style.display = (this.state.clipboard && this.state.clipboard.length > 0) ? 'block' : 'none';
        }
    }

    private setupToast() {
        const toast = document.createElement('div');
        toast.id = 'mm-toast';
        toast.className = 'mm-toast';
        this.root.appendChild(toast);
    }

    private async checkAuth() {
        try {
            const res = await fetch('/api/auth/me');
            if (res.ok) {
                const data = await res.json();
                if (data.user) {
                    const perms = data.user.permissions || [];
                    if (perms.includes('access.maps')) {
                         this.handleRouting();
                         return;
                    } else {
                        alert('You do not have permission to access the Map Maker Studio.');
                        window.location.href = '/';
                        return;
                    }
                }
            }
        } catch (e) {
            console.error(e);
        }
        
        // Not authenticated
        window.location.href = '/login';
    }

    private handleRouting() {
        const path = window.location.pathname;
        if (path === '/maps' || path === '/maps/') {
            this.loadDashboard();
        } else if (path === '/maps/home') {
            this.loadDashboard();
        } else if (path === '/maps/test') {
            this.loadTestDashboard();
        } else if (path.startsWith('/maps/')) {
            const mapId = path.split('/')[2];
            if (mapId && mapId !== 'home' && mapId !== 'pin' && mapId !== 'test') {
                this.openEditor(mapId);
            } else {
                // fallback to home
                this.loadDashboard();
            }
        } else {
            // default to home if weird path
            this.loadDashboard();
        }
    }

    public hide() {
        this.root.style.display = 'none';
    }

    public show() {
        this.root.style.display = 'block';
    }

    private async loadDashboard() {
        this.showLoader();
        try {
            const [res] = await Promise.all([
                fetch(Config.getApiUrl('/maps')),
                new Promise(resolve => setTimeout(resolve, 600)) // min 600ms
            ]);
            
            this.mapList = await res.json();
            this.renderDashboard();
        } catch (e) {
            console.error(e);
            alert('Failed to load maps');
        } finally {
            this.hideLoader();
        }
    }

    private async loadTestDashboard() {
        this.showLoader();
        try {
            const [res] = await Promise.all([
                fetch(Config.getApiUrl('/maps')),
                new Promise(resolve => setTimeout(resolve, 600))
            ]);
            
            this.mapList = await res.json();
            this.renderTestDashboard();
        } catch (e) {
            console.error(e);
        } finally {
            this.hideLoader();
        }
    }

    private renderTestDashboard() {
        this.root.innerHTML = `
            <div class="mm-dashboard-container mm-pointer-events-auto">
                <div class="mm-dashboard-header">
                    <div>
                        <h1>Map Tester</h1>
                        <p>Select a map to test physics and collisions.</p>
                    </div>
                    <button id="mm-back-dash" class="mm-btn mm-btn-secondary">Back to Studio</button>
                </div>
                
                <div class="mm-map-grid">
                    ${this.mapList.map(map => `
                        <div class="mm-map-card" data-id="${map._id}">
                            <div class="mm-map-preview"></div>
                            <div class="mm-map-info">
                                <div class="mm-map-name">${map.name}</div>
                                <div class="mm-map-meta">
                                    <span class="mm-tag mm-tag-${map.state}">${map.state}</span>
                                    <span>${map.width}x${map.height}</span>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        this.root.querySelector('#mm-back-dash')!.addEventListener('click', () => {
             history.pushState(null, '', '/maps/home');
             this.loadDashboard();
        });

        this.root.querySelectorAll('.mm-map-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.getAttribute('data-id');
                if (id) {
                     window.dispatchEvent(new CustomEvent('mapmaker:start-test', { detail: { mapId: id } }));
                }
            });
        });
    }

    private showLoader() {
        if (document.body.querySelector('#mm-loader')) return;
        const loader = document.createElement('div');
        loader.id = 'mm-loader';
        loader.className = 'mm-loader-overlay mm-pointer-events-auto';
        loader.innerHTML = `
            <div class="mm-loader-spinner"></div>
            <p style="color:var(--mm-text-muted); font-family: 'Minecraft', sans-serif; font-size: 1.5rem;">Loading...</p>
        `;
        document.body.appendChild(loader);
    }

    private hideLoader() {
        const loader = document.body.querySelector('#mm-loader');
        if (loader) {
            loader.classList.add('fade-out');
            (loader as HTMLElement).style.opacity = '0';
            setTimeout(() => loader.remove(), 500);
        }
    }

    private renderDashboard() {
        this.root.innerHTML = `
            <div class="mm-dashboard mm-pointer-events-auto">
                <div class="mm-header">
                    <h1 style="color: white; margin: 0;">Map Maker Studio</h1>
                    <div style="display: flex; gap: 1rem;">
                        <button id="mm-tester-btn" class="mm-btn mm-btn-secondary" style="width: auto;"><i class="fa-solid fa-gamepad"></i> Map Tester</button>
                        <button id="mm-new-map-btn" class="mm-btn" style="width: auto;"><i class="fa-solid fa-plus"></i> New Map</button>
                        <button id="mm-close-dash-btn" class="mm-btn mm-btn-danger" style="width: auto;"><i class="fa-solid fa-right-from-bracket"></i> Exit Studio</button>
                    </div>
                </div>
                <div class="mm-map-grid" id="mm-map-grid">
                    ${this.mapList.map(map => `
                        <div class="mm-map-card" data-id="${map._id}">
                            <div style="display:flex; justify-content:space-between; align-items:start;">
                                <h3>${map.name}</h3>
                                <div class="mm-tag mm-tag-${map.state}">${map.state}</div>
                            </div>
                            <p>${map.width} x ${map.height} Tiles</p>
                            <p style="margin-top:0.5rem; font-size:0.8rem;">Last edited: ${new Date(map.updatedAt).toLocaleDateString()}</p>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        this.root.querySelectorAll('.mm-map-card').forEach(el => {
            el.addEventListener('click', () => {
                const id = el.getAttribute('data-id');
                history.pushState(null, '', `/maps/${id}`);
                this.openEditor(id!);
            });
        });

        (this.root.querySelector('#mm-tester-btn') as HTMLElement).onclick = () => {
             history.pushState(null, '', '/maps/test');
             this.loadTestDashboard();
        };

        (this.root.querySelector('#mm-new-map-btn') as HTMLElement).onclick = () => this.createNewMap();
        (this.root.querySelector('#mm-close-dash-btn') as HTMLElement).onclick = () => {
            window.location.href = '/';
        };
    }

    private async createNewMap() {
        const modal = document.createElement('div');
        modal.className = 'mm-modal-overlay mm-pointer-events-auto';
        modal.innerHTML = `
            <div class="mm-card">
                <span class="mm-close-btn"><i class="fa-solid fa-times"></i></span>
                <h3>Create New Map</h3>
                <label class="mm-label">Map Name</label>
                <input id="new-map-name" class="mm-input" placeholder="e.g. Forest Clearing">
                <div style="display:flex; gap:1rem;">
                    <div style="flex:1;">
                        <label class="mm-label">Width</label>
                        <input id="new-map-w" type="number" class="mm-input" value="40">
                    </div>
                    <div style="flex:1;">
                        <label class="mm-label">Height</label>
                        <input id="new-map-h" type="number" class="mm-input" value="40">
                    </div>
                </div>
                <button id="create-btn" class="mm-btn">Create</button>
            </div>
        `;
        this.root.appendChild(modal);
        
        modal.querySelector('.mm-close-btn')!.addEventListener('click', () => modal.remove());
        (modal.querySelector('#create-btn') as HTMLElement).onclick = async () => {
            const name = (modal.querySelector('#new-map-name') as HTMLInputElement).value;
            const w = parseInt((modal.querySelector('#new-map-w') as HTMLInputElement).value);
            const h = parseInt((modal.querySelector('#new-map-h') as HTMLInputElement).value);
            
            if (!name || isNaN(w) || isNaN(h)) return alert("Please fill all fields");
            
            try {
                const res = await fetch(Config.getApiUrl('/maps'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, width: w, height: h })
                });
                const newMap = await res.json();
                modal.remove();
                history.pushState(null, '', `/maps/${newMap._id}`);
                this.openEditor(newMap._id);
            } catch (e) {
                alert('Error creating map');
            }
        };
    }

    private getKeyForTarget(type: string, value: string): string | null {
        for (const [key, target] of Object.entries(this.keybinds)) {
            if (target.type === type && target.value === value) return key.toUpperCase();
        }
        return null;
    }

    private async openEditor(mapId: string) {
        this.showLoader();
        try {
            const minLoadTime = new Promise(resolve => setTimeout(resolve, 600));
            const mapRes = await fetch(Config.getApiUrl(`/maps/${mapId}`));
            if (!mapRes.ok) throw new Error(`Map not found (${mapRes.status})`);
            const map = await mapRes.json();

            // sanitize map data - Convert legacy object layers to array if needed
            if (!map.layers || !Array.isArray(map.layers)) {
                const oldLayers = map.layers || {};
                const newLayers: any[] = [];
                
                // Helper to migrate legacy layer
                const migrate = (id: string, name: string) => {
                    newLayers.push({
                        id: id,
                        name: name,
                        type: 'tile',
                        visible: true,
                        locked: false,
                        data: oldLayers[id] || {}
                    });
                };
                
                migrate(DefaultLayers.BACKGROUND, 'Background');
                migrate(DefaultLayers.GROUND, 'Ground');
                migrate(DefaultLayers.WALL, 'Walls');
                migrate(DefaultLayers.DECO, 'Decoration');
                migrate(DefaultLayers.OBJECT, 'Objects');
                
                map.layers = newLayers;
            } else {
                // Ensure properties exist on loaded array layers
                map.layers.forEach((l: any) => {
                    if (l.visible === undefined) l.visible = true;
                    if (l.locked === undefined) l.locked = false;
                    if (!l.data) l.data = {};
                });
            }
            
            // fetch sequence
            const [tilesRes, groupsRes, libStructRes] = await Promise.all([
                fetch(Config.getApiUrl('/tiles')),
                fetch(Config.getApiUrl('/tile-groups')),
                fetch(Config.getApiUrl('/library')).catch(e => null)
            ]);

            const tiles = await tilesRes.json();
            const groups = groupsRes.ok ? await groupsRes.json() : [];

            tiles.forEach((t: any) => t.itemType = 'tile');
            groups.forEach((g: any) => g.itemType = 'group');
            
            const allItems = [...tiles, ...groups];
            const dataMap = new Map<string, any>();
            allItems.forEach(i => dataMap.set(i.id, i));

            // hydrate library
            let libStruct: any[] = [];
            if (libStructRes && libStructRes.ok) libStruct = await libStructRes.json();

            if (libStruct && libStruct.length > 0) {
                 this.state.library = this.hydrateStructure(libStruct, dataMap);
                 const used = new Set<string>();
                 const collect = (l: any[]) => l.forEach(x => {
                     if(typeof x === 'string') used.add(x);
                     else if (x.itemType === 'folder') collect(x.items);
                 });
                 collect(libStruct);
                 const orphans = allItems.filter(i => !used.has(i.id));
                 this.state.library.push(...orphans);
            } else {
                 this.state.library = allItems;
            }

            // Inject System Tiles
            this.state.library.unshift({
                id: SYSTEM_TILES.INVISIBLE,
                name: 'Invisible Collision',
                itemType: 'tile',
                imageUrl: '' 
            } as any);

            this.state.library.unshift({
                id: SYSTEM_TILES.SPAWN,
                name: 'Spawn Point',
                itemType: 'tile',
                imageUrl: '' // Special render
            } as any);

            this.state.currentMap = map;
            this.state.palette = [];

            // hydrate palette
            if (map.palette && Array.isArray(map.palette)) {
                // legacy support
                 if (map.palette.length > 0 && typeof map.palette[0] === 'string' && map.palette.every((x:any) => typeof x === 'string')) {
                      this.state.palette = map.palette.map((id: string) => dataMap.get(id)).filter((x:any) => x);
                 } else {
                      this.state.palette = this.hydrateStructure(map.palette, dataMap);
                 }
            }

            if (this.state.palette.length > 0) {
                if (!this.state.selectedTileId || !this.state.palette.find(t => t.id === this.state.selectedTileId)) {
                   const findFirst = (list: any[]): string | null => {
                       for(const i of list) {
                           if (i.itemType!=='folder' && i.id) return i.id;
                           if (i.itemType==='folder') {
                               const found = findFirst(i.items);
                               if (found) return found;
                           }
                       }
                       return null;
                   };
                   const firstId = findFirst(this.state.palette);
                   this.state.selectedTileId = firstId;
                }
            } else {
                this.state.selectedTileId = null;
            }

            await minLoadTime;

            // check scaffold
            if (!this.root.querySelector('#mm-sidebars')) {
                this.renderStaticUI();
            }

            this.renderEditor();
            this.onStateChange?.(this.state);
            window.dispatchEvent(new CustomEvent('mapmaker:open'));
        } catch (e: any) {
            console.error(e);
            alert('Failed to load editor: ' + e.message);
        } finally {
            this.hideLoader();
        }
    }

    private renderItemList(items: (ITile | ITileGroup | IFolder)[], listType: 'library' | 'palette'): string {
        return items.filter(t => (t as any).itemType === 'folder' || !(t as any).hidden).map(t => {
            const isFolder = (t as any).itemType === 'folder';
            
            if (isFolder) {
                const f = t as IFolder;
                const isExpanded = !f.collapsed;
                const addBtn = (listType === 'library') ? 
                    `<i class="fa-solid fa-plus-square mm-folder-add-btn" title="Add to Palette" style="margin-right:5px; margin-left:5px;"></i>` : '';

                return `
                <div class="mm-folder-container" 
                     draggable="true" 
                     data-id="${f.id}" 
                     data-type="folder"
                     data-list="${listType}"
                     style="grid-column: 1 / -1; margin-bottom: 0.5rem;">
                    
                    <div class="mm-folder-header" style="
                        background: ${f.color}22; 
                        border: 1px solid ${f.color}; 
                        border-radius: 4px;
                        padding: 0.5rem;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 0.5rem;
                        color: ${f.color};
                        font-weight: bold;
                    ">
                        <i class="fa-solid fa-${f.icon}"></i>
                        <span style="flex:1">${f.name}</span>
                        ${addBtn}
                        <i class="fa-solid fa-chevron-${isExpanded ? 'up' : 'down'}"></i>
                    </div>
                    
                    ${isExpanded ? `
                        <div class="mm-folder-content" style="
                            background: rgba(0,0,0,0.2);
                            border: 1px solid ${f.color}44;
                            border-top: none;
                            padding: 0.5rem;
                            display: grid;
                            grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
                            gap: 0.25rem;
                        " data-folder-id="${f.id}" data-list="${listType}">
                             ${this.renderItemList(f.items, listType)}
                             <div class="mm-drop-zone-placeholder" data-folder-id="${f.id}" style="height:40px;"></div>
                        </div>
                    ` : ''}
                </div>`;
            } else {
                const item = t as ITile | ITileGroup;
                const img = (item as any).previewUrl || (item as any).imageUrl;
                const isActive = this.state.selectedTileId === item.id;
                const isGroup = (item as any).itemType === 'group';
                
                let style = `background-image: url('${Config.getImageUrl(img)}');`;
                let label = '';
                
                if (item.id === SYSTEM_TILES.SPAWN) {
                    style = 'background-color: rgba(0, 0, 255, 0.5);';
                    label = '<div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:white; font-size:10px; font-weight:bold;">SPAWN</div>';
                } else if (item.id === SYSTEM_TILES.INVISIBLE) {
                    style = 'background-color: rgba(255, 0, 255, 0.3); border: 1px dashed rgba(255,255,255,0.5);'; // Pinkish-transparent for visibility in editor against black bg
                    label = '<div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:white; font-size:10px; font-weight:bold; text-shadow:0 0 2px black;">INV</div>';
                }

                return `
                <div class="mm-tile-item ${isActive ? 'active' : ''} ${isGroup ? 'mm-tile-group' : ''}" 
                        draggable="true"
                        data-id="${item.id}"
                        data-type="item"
                        data-list="${listType}"
                        data-action="${listType === 'library' ? 'add-to-palette' : 'select'}"
                        style="${style} position: relative;"
                        title="${item.name}">
                        ${label}
                        ${isActive ? '<div class="mm-tile-selected-indicator"><i class="fa-solid fa-check"></i></div>' : ''}
                </div>
            `;
            }
        }).join('');
    }

    // --- Layer Management ---

    private async addLayer() {
        if (!this.state.currentMap || this.state.currentMap.state !== MapState.DRAFT) return;
        
        const name = prompt("Enter new layer name:", "New Layer");
        if (!name) return;

        const id = `custom_${Date.now()}`;
        const layers = this.state.currentMap.layers as ILayer[];
        
        // Add to top (end of array)
        layers.push({
            id: id,
            name: name,
            type: 'tile',
            visible: true,
            locked: false,
            data: {}
        });
        
        this.state.selectedLayer = id;
        this.renderEditor();
        this.saveMap();
    }

    private async deleteLayer(id: string) {
        if (!this.state.currentMap || this.state.currentMap.state !== MapState.DRAFT) return;
        const layers = this.state.currentMap.layers as ILayer[];

        if (layers.length <= 1) {
            alert("Cannot delete the last layer.");
            return;
        }

        const layerObj = layers.find(l => l.id === id);
        if (!layerObj) return;

        if (!confirm(`Are you sure you want to delete layer "${layerObj.name}"? This cannot be undone.`)) return;

        const idx = layers.findIndex(l => l.id === id);
        if (idx !== -1) {
            layers.splice(idx, 1);
            if (this.state.selectedLayer === id) {
                // select previous or first
                const newIdx = Math.max(0, idx - 1);
                this.state.selectedLayer = layers[newIdx] ? layers[newIdx].id : '';
            }
            this.renderEditor();
            this.saveMap();
        }
    }

    private renameLayer(id: string) {
        if (!this.state.currentMap) return;
        const layer = this.state.currentMap.layers.find((l:any) => l.id === id);
        if (!layer) return;

        const newName = prompt("Enter new layer name:", layer.name);
        if (newName && newName !== layer.name) {
            layer.name = newName;
            this.renderEditor();
            this.saveMap();
        }
    }

    private moveLayer(id: string, dir: 'up' | 'down') {
        if (!this.state.currentMap) return;
        const layers = this.state.currentMap.layers;
        const index = layers.findIndex((l:any) => l.id === id);
        if (index === -1) return;

        if (dir === 'up') {
            if (index >= layers.length - 1) return;
            // swap with next (visual up is array end)
            [layers[index], layers[index + 1]] = [layers[index + 1], layers[index]];
        } else {
            if (index <= 0) return;
            // swap with prev
            [layers[index], layers[index - 1]] = [layers[index - 1], layers[index]];
        }
        
        this.renderEditor();
        this.saveMap();
    }

    private toggleLayerProperty(id: string, prop: 'visible' | 'locked' | 'collidable' | 'above') {
        if (!this.state.currentMap) return;
        const layer = this.state.currentMap.layers.find((l:any) => l.id === id);
        if (!layer) return;

        if (prop === 'collidable') {
            if (!layer.properties) layer.properties = {};
            layer.properties.collidable = !layer.properties.collidable;
            // Mutually exclusive
            if (layer.properties.collidable) {
                layer.properties.above = false;
                layer.properties.solidRoof = false;
            }
        } else if (prop === 'above') {
            if (!layer.properties) layer.properties = {};
            
            const isAbove = layer.properties.above === true;
            const isSolid = layer.properties.solidRoof === true;

            if (!isAbove && !isSolid) {
                // State 1 -> 2: Standard -> Roof
                layer.properties.above = true;
                layer.properties.solidRoof = false;
                layer.properties.collidable = false;
            } else if (isAbove && !isSolid) {
                // State 2 -> 3: Roof -> Solid Roof
                layer.properties.above = true;
                layer.properties.solidRoof = true;
                layer.properties.collidable = false;
            } else {
                // State 3 -> 1: Solid Roof -> Standard
                layer.properties.above = false;
                layer.properties.solidRoof = false;
            }
        } else {
            layer[prop] = !layer[prop];
        }
        
        // update render
        this.renderEditor();
        this.updateState();
        if (prop === 'collidable' || prop === 'above') this.saveMap();
    }

    private renderEditor() {
        if (!this.state.currentMap) return;
        const map = this.state.currentMap;

        const isDraft = map.state === MapState.DRAFT;
        const undoBtn = this.root.querySelector('#mm-undo-btn') as HTMLElement;
        const redoBtn = this.root.querySelector('#mm-redo-btn') as HTMLElement;
        
        if (undoBtn) undoBtn.style.display = isDraft ? 'flex' : 'none';
        if (redoBtn) redoBtn.style.display = isDraft ? 'flex' : 'none';

        const selectedTile = this.state.palette.find(t => t.id === this.state.selectedTileId);
        const isGroup = selectedTile && (selectedTile as any).itemType === 'group';
        
        const isFill = this.state.selectedTool === 'fill';
        const brushControlsDisplay = (isFill || isGroup) ? 'none' : 'block';
          const isCollapse = this.state.layerPanelCollapsed;
          const isLibraryCollapsed = this.state.libraryCollapsed;
          
          // Find selected layer name safely
          const selectedLayerObj = map.layers.find((l:any) => l.id === this.state.selectedLayer);
          const selectedLayerLabel = selectedLayerObj ? selectedLayerObj.name : 'None';

        const renderLayerItem = (layer: any, index: number) => {
            const isActive = this.state.selectedLayer === layer.id;
            
            // Vis/Lock come from layer object now
            const isVisible = layer.visible !== false;
            const isLocked = layer.locked === true;
            const isCollidable = layer.properties?.collidable === true;
            const isAbove = layer.properties?.above === true;
            const isSolid = layer.properties?.solidRoof === true;

            let aboveIcon = '<i class="fa-solid fa-arrow-up-from-bracket"></i>';
            let aboveTitle = "Set Layer Type (Standard)";
            let aboveClass = "";

            if (isSolid) {
                aboveIcon = '<i class="fa-solid fa-cube"></i>';
                aboveTitle = "Solid Roof (High Z, No Fade)";
                aboveClass = "active";
            } else if (isAbove) {
                aboveIcon = '<i class="fa-solid fa-layer-group"></i>';
                aboveTitle = "Roof (High Z, Fades)";
                aboveClass = "active";
            }
            
            const preview = this.state.layerPreviews[layer.id];
            const previewStyle = preview ? `background-image: url(${preview});` : '';
            
            // Layer Controls (Show only if active)
            let controls = '';
            // Only show advanced controls if map is draft and active
            if (isActive && isDraft) {
                controls = `
                <div class="mm-layer-actions" style="display:flex; gap:2px; margin-right:5px;">
                     <button class="mm-icon-btn small layer-move-up" data-id="${layer.id}" title="Move Up" ${index === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
                     <button class="mm-icon-btn small layer-move-down" data-id="${layer.id}" title="Move Down" ${index === map.layers.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
                     <button class="mm-icon-btn small layer-rename" data-id="${layer.id}" title="Rename"><i class="fa-solid fa-pen"></i></button>
                     <button class="mm-icon-btn small layer-delete danger" data-id="${layer.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </div>
                `;
            }

            return `
            <div class="mm-layer-item ${isActive ? 'active' : ''}" data-id="${layer.id}" style="padding-right: 5px;">
                <div class="mm-layer-controls">
                    ${isDraft ? `
                    <button class="mm-icon-btn toggle-collidable ${isCollidable ? 'active' : ''}" data-id="${layer.id}" title="Toggle Collidable (Wall)">
                        ${isCollidable ? '<i class="fa-solid fa-person-falling-burst"></i>' : '<i class="fa-solid fa-person"></i>'}
                    </button>
                    <button class="mm-icon-btn toggle-above ${aboveClass}" data-id="${layer.id}" title="${aboveTitle}">
                        ${aboveIcon}
                    </button>
                    ` : ''}
                    <button class="mm-icon-btn toggle-vis ${isVisible ? 'active' : ''}" data-id="${layer.id}" title="Toggle Visibility">
                        ${isVisible ? '<i class="fa-solid fa-eye"></i>' : '<i class="fa-solid fa-eye-slash"></i>'}
                    </button>
                    <button class="mm-icon-btn toggle-lock ${isLocked ? 'active' : ''}" data-id="${layer.id}" title="Toggle Lock">
                        ${isLocked ? '<i class="fa-solid fa-lock"></i>' : '<i class="fa-solid fa-lock-open"></i>'}
                    </button>
                </div>
                
                <div class="mm-layer-name" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${layer.name}</div>
                ${controls}
                <div class="mm-layer-preview" style="${previewStyle}"></div>
            </div>`;
        };

        const sidebarsContainer = this.root.querySelector('#mm-sidebars');
        if (!sidebarsContainer) return;

        // Render layers in reverse order for display (top layer on top)
        const reversedLayers = [...map.layers].map((l:any, i:number) => ({ l, originalIndex: i })).reverse();

        sidebarsContainer.innerHTML = `
            <div class="mm-left-sidebar">
                <!-- Library Panel -->
                <div class="mm-library-panel mm-pointer-events-auto">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:${isLibraryCollapsed ? '0' : '0.5rem'}; border-bottom:${isLibraryCollapsed ? 'none' : '1px solid #333'}; padding-bottom:${isLibraryCollapsed ? '0' : '0.5rem'};">
                        <h3 style="color:white; margin:0; font-size:1.1rem;">Library</h3>
                        <div style="display:flex; gap:0.5rem; align-items:center;">
                            <button id="mm-upload-tile-btn" class="mm-btn" style="width:auto; font-size:0.7rem; padding:0.3rem;" title="Upload Tile/Group"><i class="fa-solid fa-upload"></i></button>
                            <button id="mm-collapse-library-btn" class="mm-icon-btn" title="${isLibraryCollapsed ? 'Expand' : 'Collapse'}">
                                ${isLibraryCollapsed ? '<i class="fa-solid fa-chevron-down"></i>' : '<i class="fa-solid fa-chevron-up"></i>'}
                            </button>
                        </div>
                    </div>
                    ${isLibraryCollapsed ? '' : `
                    <div class="mm-tile-list" id="mm-library-list" data-list="library">
                        ${this.renderItemList(this.state.library, 'library')}
                    </div>
                    `}
                </div>

                <!-- Layer Panel -->
                <div class="mm-layer-panel mm-pointer-events-auto">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:${isCollapse ? '0' : '1rem'}; padding-bottom:${isCollapse ? '0' : '0.5rem'}; border-bottom:${isCollapse ? 'none' : '1px solid #333'};">
                        <h3 style="color:white; margin:0; font-size:1.1rem;">Layers</h3>
                        <div style="display:flex; gap: 5px;">
                            ${isDraft ? `<button id="mm-add-layer-btn" class="mm-icon-btn" title="Add Layer"><i class="fa-solid fa-plus"></i></button>` : ''}
                            <button id="mm-collapse-layers-btn" class="mm-icon-btn" title="${isCollapse ? 'Expand' : 'Collapse'}">
                                ${isCollapse ? '<i class="fa-solid fa-chevron-down"></i>' : '<i class="fa-solid fa-chevron-up"></i>'}
                            </button>
                        </div>
                    </div>
                    ${isCollapse ? `
                        <div style="color:#aaa; font-size:0.9rem; margin-top:0.5rem; display:flex; align-items:center; justify-content:space-between;">
                            <span>Selected: <span style="color:white; font-weight:bold;">${selectedLayerLabel}</span></span>
                        </div>
                    ` : `
                        <div class="mm-layer-list">
                            ${reversedLayers.map(x => renderLayerItem(x.l, x.originalIndex)).join('')}
                        </div>
                    `}
                </div>
            </div>

            <!-- Right Editor Sidebar -->
            <div class="mm-editor-sidebar mm-pointer-events-auto">
                <div class="mm-sidebar-section">
                    <h3>${map.name}</h3>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                        <span class="mm-tag mm-tag-${map.state}">${map.state}</span>
                        ${map.state === MapState.DRAFT ? 
                            `<button id="mm-state-btn" class="mm-btn" style="width:auto; font-size:0.7rem; padding:0.3rem 0.6rem;"><i class="fa-solid fa-check"></i> Submit Review</button>` :
                         map.state === MapState.REVIEW ?
                            `<button id="mm-state-btn" class="mm-btn" style="width:auto; font-size:0.7rem; padding:0.3rem 0.6rem;"><i class="fa-solid fa-rotate-left"></i> Revert Draft</button>` : ''
                        }
                    </div>
                    
                    <hr style="border: 0; border-top: 1px solid var(--mm-border); margin: 1rem 0;">
                    
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem;">
                        <button id="mm-save-btn" class="mm-btn" ${map.state !== MapState.DRAFT || this.state.palette.length === 0 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}><i class="fa-solid fa-floppy-disk"></i> Save</button>
                        <button id="mm-exit-editor-btn" class="mm-btn mm-btn-danger"><i class="fa-solid fa-right-from-bracket"></i> Exit</button>
                    </div>
                </div>

                <div style="position: relative; flex: 1; display: flex; flex-direction: column; overflow: hidden;">
                    ${map.state !== MapState.DRAFT ? `<div class="mm-sidebar-lock-overlay"><p>Map is in ${map.state} state.<br>Revert to Draft to edit.</p></div>` 
                    : this.state.palette.length === 0 ? `<div class="mm-sidebar-lock-overlay"><p>Add tiles from Library to start editing</p></div>` : ''}

                    <div class="mm-sidebar-section">
                    <div class="mm-tool-grid" style="grid-template-columns: repeat(4, 1fr);">
                        <div class="mm-tool-btn ${this.state.selectedTool === 'place' ? 'active' : ''}" data-tool="place" title="Place" data-bind-type="tool" data-bind-value="place">
                            ${this.getKeyForTarget('tool', 'place') ? `<div class="mm-keybind-badge" style="left:2px; right:auto;">${this.getKeyForTarget('tool', 'place')}</div>` : ''}
                            <i class="fa-solid fa-pencil"></i>
                        </div>
                        <div class="mm-tool-btn ${this.state.selectedTool === 'erase' ? 'active' : ''}" data-tool="erase" title="Erase" data-bind-type="tool" data-bind-value="erase">
                            ${this.getKeyForTarget('tool', 'erase') ? `<div class="mm-keybind-badge" style="left:2px; right:auto;">${this.getKeyForTarget('tool', 'erase')}</div>` : ''}
                            <i class="fa-solid fa-eraser"></i>
                        </div>
                        <div class="mm-tool-btn ${this.state.selectedTool === 'fill' ? 'active' : ''}" data-tool="fill" title="Fill" data-bind-type="tool" data-bind-value="fill">
                            ${this.getKeyForTarget('tool', 'fill') ? `<div class="mm-keybind-badge" style="left:2px; right:auto;">${this.getKeyForTarget('tool', 'fill')}</div>` : ''}
                            <i class="fa-solid fa-fill-drip"></i>
                        </div>
                        <div class="mm-tool-btn ${this.state.selectedTool === 'select' ? 'active' : ''}" data-tool="select" title="Select" data-bind-type="tool" data-bind-value="select">
                            ${this.getKeyForTarget('tool', 'select') ? `<div class="mm-keybind-badge" style="left:2px; right:auto;">${this.getKeyForTarget('tool', 'select')}</div>` : ''}
                            <i class="fa-solid fa-vector-square"></i>
                        </div>
                    </div>
                    
                    <div style="display: ${this.state.selectedTool === 'fill' ? 'none' : 'block'}; margin-bottom:0.5rem;">
                        <label class="mm-label">Shape</label>
                        ${this.state.selectedTool === 'select' ? `
                             <div class="mm-tool-grid" style="grid-template-columns: repeat(2, 1fr); gap: 0.5rem;">
                                 <div class="mm-tool-btn ${this.state.shape === 'square' ? 'active' : ''}" data-shape="square" data-bind-type="shape" data-bind-value="square" title="Rectangle">
                                     ${this.getKeyForTarget('shape', 'square') ? `<div class="mm-keybind-badge" style="left:2px; right:auto;">${this.getKeyForTarget('shape', 'square')}</div>` : ''}
                                     <i class="fa-solid fa-vector-square"></i>
                                 </div>
                                 <div class="mm-tool-btn ${this.state.shape === 'freeform' ? 'active' : ''}" data-shape="freeform" data-bind-type="shape" data-bind-value="freeform" title="Freeform">
                                     ${this.getKeyForTarget('shape', 'freeform') ? `<div class="mm-keybind-badge" style="left:2px; right:auto;">${this.getKeyForTarget('shape', 'freeform')}</div>` : ''}
                                     <i class="fa-solid fa-hand-pointer"></i>
                                 </div>
                             </div>
                        ` : `
                        <div class="mm-tool-grid" style="grid-template-columns: repeat(2, 1fr); gap: 0.5rem;">
                            <div class="mm-tool-btn ${this.state.shape === 'square' ? 'active' : ''}" data-shape="square" data-bind-type="shape" data-bind-value="square" title="Square">
                                ${this.getKeyForTarget('shape', 'square') ? `<div class="mm-keybind-badge" style="left:2px; right:auto;">${this.getKeyForTarget('shape', 'square')}</div>` : ''}
                                <i class="fa-solid fa-square"></i>
                            </div>
                            <div class="mm-tool-btn ${this.state.shape === 'circle' ? 'active' : ''}" data-shape="circle" data-bind-type="shape" data-bind-value="circle" title="Circle">
                                ${this.getKeyForTarget('shape', 'circle') ? `<div class="mm-keybind-badge" style="left:2px; right:auto;">${this.getKeyForTarget('shape', 'circle')}</div>` : ''}
                                <i class="fa-solid fa-circle"></i>
                            </div>
                            <div class="mm-tool-btn ${this.state.shape === 'perlin-square' ? 'active' : ''}" data-shape="perlin-square" data-bind-type="shape" data-bind-value="perlin-square" title="Perlin Square">
                                ${this.getKeyForTarget('shape', 'perlin-square') ? `<div class="mm-keybind-badge" style="left:2px; right:auto;">${this.getKeyForTarget('shape', 'perlin-square')}</div>` : ''}
                                <i class="fa-solid fa-square-virus"></i>
                            </div>
                            <div class="mm-tool-btn ${this.state.shape === 'perlin-circle' ? 'active' : ''}" data-shape="perlin-circle" data-bind-type="shape" data-bind-value="perlin-circle" title="Perlin Circle">
                                ${this.getKeyForTarget('shape', 'perlin-circle') ? `<div class="mm-keybind-badge" style="left:2px; right:auto;">${this.getKeyForTarget('shape', 'perlin-circle')}</div>` : ''}
                                <i class="fa-solid fa-virus"></i>
                            </div>
                        </div>
                        `}
                        ${this.state.shape.startsWith('perlin') ? 
                            `<button id="mm-regen-noise-btn" class="mm-btn" style="margin-top:0.5rem; font-size:0.75rem; padding:0.4rem; background: #444;"><i class="fa-solid fa-dice"></i> Regenerate Pattern</button>` 
                            : ''
                        }
                    </div>

                    ${this.state.selectedTool === 'select' ? '' : `
                    <div style="display: ${brushControlsDisplay}; margin-bottom:0.5rem;">
                        <label class="mm-label">Brush Size: <span id="mm-radius-val">${this.state.radius}</span></label>
                        <input type="range" id="mm-radius-input" min="1" max="9" step="2" value="${this.state.radius}" style="width:100%">
                    </div>

                    <div>
                        <label class="mm-label">Density: <span id="mm-diffusion-val">${this.state.diffusion}%</span></label>
                        <input type="range" id="mm-diffusion-input" min="1" max="100" value="${this.state.diffusion}" style="width:100%">
                    </div>
                    `}
                </div>

                <div class="mm-sidebar-section" style="flex:1; display:flex; flex-direction:column; overflow:hidden; padding-bottom:0;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                        <label class="mm-label" style="margin:0;">Map Palette</label>
                        <button id="mm-palette-add-folder-btn" class="mm-icon-btn" title="Add Folder"><i class="fa-solid fa-folder-plus"></i></button>
                    </div>
                    <div class="mm-tile-list" id="mm-palette-list" data-list="palette">
                        ${this.renderItemList(this.state.palette, 'palette')}
                    </div>
                </div>
            </div>
        `;

        this.bindEditorEvents();
    }

    private handleTileContextMenu(e: MouseEvent, id: string, isLibrary: boolean) {
        this.closeContextMenu();
        
        // find in library or palette, recursive
        const list = isLibrary ? this.state.library : this.state.palette;
        const tile = this.findItemRecursive(list, id);
        
        if (!tile) return;

        const options = [];
        const isGroup = (tile as any).itemType === 'group';
        const isFolder = (tile as any).itemType === 'folder';

        if (isLibrary) {
            if (!isGroup && !isFolder) {
                options.push({ label: 'Edit (Global)', action: () => this.showEditTileModal(tile as ITile) });
            }
            options.push({ label: 'Delete', danger: true, action: () => this.deleteTile(tile) });
        } else {
            options.push({ label: 'Remove', danger: true, action: () => this.removeFromPalette(tile) });
            
            if (!isGroup && !isFolder) {
                options.push({ label: 'Edit (Global)', action: () => this.showEditTileModal(tile as ITile) });
                options.push({ label: 'Edit (Local)', action: () => this.editTileLocal(tile as ITile) });
            }
            
            const key = this.getKeyForTarget('tile', tile.id);
            if (key) {
                options.push({ label: `Del Keybind (${key})`, action: () => this.removeKeybind(key) });
            }
        }

        this.showContextMenu(e.clientX, e.clientY, options);
    }

    private showContextMenu(x: number, y: number, options: any[]) {
        const menu = document.createElement('div');
        menu.className = 'mm-context-menu';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        
        options.forEach(opt => {
            const item = document.createElement('div');
            item.className = `mm-context-menu-item ${opt.danger ? 'danger' : ''}`;
            item.textContent = opt.label;
            item.onclick = () => {
                this.closeContextMenu();
                opt.action();
            };
            menu.appendChild(item);
        });
        
        this.root.appendChild(menu);
        
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 10}px`;
        if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 10}px`;
    }

    private async deleteTile(tile: ITile | any) {
        if (tile.itemType === 'folder') {
            if (!confirm(`Using "Delete" on a folder will permanently delete it. Are you sure? (Contents will be removed from view but not deleted from database)`)) return;
            this.removeItemRecursive(this.state.library, tile.id);
            this.renderEditor();
            return;
        }

        const isGroup = tile.itemType === 'group';
        const typeLabel = isGroup ? "Tile Group" : "Tile";
        
        if (!confirm(`Delete ${typeLabel} "${tile.name}" from Server? This will break maps using it.`)) return;
        
        try {
            const endpoint = isGroup ? `/tile-groups/${tile.id}` : `/tiles/${tile.id}`;
            const res = await fetch(Config.getApiUrl(endpoint), { method: 'DELETE' });
            
            if (!res.ok) {
                 const err = await res.json();
                 throw new Error(err.error || 'Delete failed');
            }

            // refresh the full library
            await this.refreshLibrary();

            // clear from palette if selected
            this.state.palette = this.state.palette.filter(t => t.id !== tile.id);
            if (this.state.selectedTileId === tile.id) this.state.selectedTileId = null;
            
            this.renderEditor();
            this.updateState();
        } catch (e: any) { 
            alert('Delete failed: ' + e.message); 
        }
    }

    private removeFromPalette(tile: ITile | ITileGroup) {
        // reuse recursive remove
        this.removeItemRecursive(this.state.palette, tile.id);
        if (this.state.selectedTileId === tile.id) this.state.selectedTileId = null;
        this.renderEditor();
        this.updateState();
        this.saveMap();
    }

    private removeKeybind(key: string) {
        delete this.keybinds[key];
        localStorage.setItem('mm_keybinds', JSON.stringify(this.keybinds));
        this.renderEditor();
    }

    private editTileLocal(tile: ITile) {
        const newId = `${tile.id}_${this.state.currentMap!._id!.substring(0,6)}_${Math.floor(Math.random()*1000)}`;
        this.showEditTileModal(tile, newId);
    }

    private showEditTileModal(tile: ITile, newLocalId?: string) {
        const modal = document.createElement('div');
        modal.className = 'mm-modal-overlay mm-pointer-events-auto';
        modal.innerHTML = `
            <div class="mm-card">
                <span class="mm-close-btn"><i class="fa-solid fa-times"></i></span>
                <h3>${newLocalId ? 'Edit Tile (Local Copy)' : 'Edit Tile (Global)'}</h3>
                <form id="mm-edit-form">
                    <label class="mm-label">Tile Name</label>
                    <input type="text" name="name" value="${tile.name} ${newLocalId ? '(Local)' : ''}" class="mm-input" required>
                    
                    <div style="display:flex; gap:1rem;">
                        <div style="flex:1;">
                            <label class="mm-label">Movable</label>
                            <select name="movable" class="mm-select">
                                <option value="false" ${!tile.movable ? 'selected' : ''}>No</option>
                                <option value="true" ${tile.movable ? 'selected' : ''}>Yes</option>
                            </select>
                        </div>
                    </div>

                    <div style="display:flex; gap:1rem;">
                         <div style="flex:1;">
                            <label class="mm-label">Speed Mult</label>
                            <input type="number" name="speedMultiplier" value="${tile.speedMultiplier}" step="0.1" class="mm-input">
                        </div>
                        <div style="flex:1;">
                            <label class="mm-label">Damage/Tick</label>
                            <input type="number" name="damagePerTick" value="${tile.damagePerTick}" class="mm-input">
                        </div>
                    </div>
                    
                    <label class="mm-label">Behavior ID</label>
                    <input type="text" name="behaviorId" value="${tile.behaviorId || ''}" class="mm-input">

                    <button type="submit" class="mm-btn" style="margin-top:1rem;">${newLocalId ? 'Create Local Copy' : 'Save Changes'}</button>
                </form>
            </div>
        `;
        this.root.appendChild(modal);

        modal.querySelector('.mm-close-btn')!.addEventListener('click', () => modal.remove());
        
        const form = modal.querySelector('#mm-edit-form') as HTMLFormElement;
        form.onsubmit = async (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            const data: any = {};
            formData.forEach((value, key) => data[key] = value);
            data.movable = data.movable === 'true'; 

            try {
                if (newLocalId) {
                    data.tileId = newLocalId;
                    data.imageUrl = tile.imageUrl;
                    
                    const res = await fetch(Config.getApiUrl('/tiles'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    if (!res.ok) throw new Error('Create failed');
                    
                    const newTile = await res.json();
                    this.state.library.push(newTile);
                    
                    const idx = this.state.palette.findIndex(t => t.id === tile.id);
                    if (idx !== -1) this.state.palette[idx] = newTile;
                    else this.state.palette.push(newTile);
                    
                    if (this.state.selectedTileId === tile.id) this.state.selectedTileId = newTile.id;
                    this.saveMap();
                } else {
                    const res = await fetch(Config.getApiUrl(`/tiles/${tile.id}`), {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    if (!res.ok) throw new Error('Update failed');
                    
                    const tilesRes = await fetch(Config.getApiUrl('/tiles'));
                    this.state.library = await tilesRes.json();
                    this.state.palette = this.state.library.filter(t => this.state.palette.find(p => p.id === t.id));
                }
                
                modal.remove();
                this.renderEditor();
                this.updateState();
            } catch (err: any) {
                alert('Action failed: ' + err.message);
            }
        };
    }

    private bindEditorEvents() {
        // hover listeners for keybinding
        this.root.querySelectorAll('[data-bind-type]').forEach(el => {
            el.addEventListener('mouseenter', () => {
                const type = el.getAttribute('data-bind-type') as any;
                const value = el.getAttribute('data-bind-value') as string;
                this.hoveredTarget = { type, value };
            });
            el.addEventListener('mouseleave', () => {
                this.hoveredTarget = null;
            });
        });

        // hide cursor
        this.root.querySelectorAll('.mm-pointer-events-auto').forEach(el => {
            el.addEventListener('mouseenter', () => window.dispatchEvent(new CustomEvent('mapmaker:ui-enter')));
            el.addEventListener('mouseleave', () => window.dispatchEvent(new CustomEvent('mapmaker:ui-leave')));
        });

        // collapse layers
        const collapseBtn = this.root.querySelector('#mm-collapse-layers-btn');
        if (collapseBtn) {
            collapseBtn.addEventListener('click', () => {
                this.state.layerPanelCollapsed = !this.state.layerPanelCollapsed;
                this.renderEditor();
            });
        }

        const collapseLibBtn = this.root.querySelector('#mm-collapse-library-btn');
        if (collapseLibBtn) {
            collapseLibBtn.addEventListener('click', () => {
                this.state.libraryCollapsed = !this.state.libraryCollapsed;
                this.renderEditor();
            });
        }

        const libAddFolderBtn = document.createElement('button');
        libAddFolderBtn.id = 'mm-library-add-folder-btn';
        libAddFolderBtn.className = 'mm-btn';
        libAddFolderBtn.style.width = 'auto';
        libAddFolderBtn.style.fontSize = '0.7rem';
        libAddFolderBtn.style.padding = '0.3rem';
        libAddFolderBtn.title = 'Add Folder';
        libAddFolderBtn.innerHTML = '<i class="fa-solid fa-folder-plus"></i>';
        
        // inject into library header
        const libHeader = this.root.querySelector('.mm-library-panel h3')?.parentElement?.querySelector('div');
         if (libHeader) {
            libHeader.insertBefore(libAddFolderBtn, libHeader.firstChild);
        }

        libAddFolderBtn.addEventListener('click', () => this.showCreateFolderModal('library'));

        const palAddFolderBtn = this.root.querySelector('#mm-palette-add-folder-btn');
        if (palAddFolderBtn) {
             palAddFolderBtn.addEventListener('click', () => this.showCreateFolderModal('palette'));
        }

        this.bindDragDropEvents();

        this.root.querySelectorAll('.mm-folder-header').forEach(el => {
            el.addEventListener('contextmenu', (e) => {
                 e.preventDefault();
                 e.stopPropagation();
                 const container = el.closest('.mm-folder-container') as HTMLElement;
                 const folderId = container.getAttribute('data-id');
                 const listType = container.getAttribute('data-list');

                 if (folderId && listType) {
                     this.handleFolderContextMenu(e as MouseEvent, folderId, listType as 'library'|'palette');
                 }
            });

            const addBtn = el.querySelector('.mm-folder-add-btn');
            if (addBtn) {
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                     const container = el.closest('.mm-folder-container') as HTMLElement;
                     const folderId = container.getAttribute('data-id');
                     if(folderId) this.addFolderToPalette(folderId);
                });
            }

            el.addEventListener('click', (e) => {
                e.stopPropagation();
                if ((e.target as HTMLElement).classList.contains('mm-folder-add-btn')) return;

                const container = el.closest('.mm-folder-container') as HTMLElement;
                const folderId = container.getAttribute('data-id');
                const listType = container.getAttribute('data-list') as 'library' | 'palette';
                
                const list = listType === 'library' ? this.state.library : this.state.palette;
                const folder = this.findItemRecursive(list, folderId!) as IFolder;
                
                if (folder) {
                    if (folder.items.length > 0) {
                        folder.collapsed = !folder.collapsed;
                        this.renderEditor();
                    }
                }
            });
        });

        // -- Layer Management --

        // Layer selection
        this.root.querySelectorAll('.mm-layer-item').forEach(el => {
            el.addEventListener('click', (e) => {
                // Ignore clicks on controls
                if ((e.target as HTMLElement).closest('.layer-controls') || 
                    (e.target as HTMLElement).closest('.layer-vis-toggle')) return;
                
                const layerId = el.getAttribute('data-id');
                if (layerId) {
                    this.state.selectedLayer = layerId;
                    this.renderEditor();
                    this.updateState();
                }
            });
        });

        // Add Layer
        const addLayerBtn = this.root.querySelector('#mm-add-layer-btn');
        if (addLayerBtn) {
            addLayerBtn.addEventListener('click', () => {
                this.addLayer();
            });
        }

        // Layer Visibility
        this.root.querySelectorAll('.toggle-vis').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const layerId = el.getAttribute('data-id');
                if (layerId) this.toggleLayerProperty(layerId, 'visible');
            });
        });

        // Layer Lock
        this.root.querySelectorAll('.toggle-lock').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const layerId = el.getAttribute('data-id');
                if (layerId) this.toggleLayerProperty(layerId, 'locked');
            });
        });

        // Layer Physics/Collision
        this.root.querySelectorAll('.toggle-collidable').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const layerId = el.getAttribute('data-id');
                if (layerId) this.toggleLayerProperty(layerId, 'collidable');
            });
        });

        // Layer Above (Overhead)
        this.root.querySelectorAll('.toggle-above').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const layerId = el.getAttribute('data-id');
                if (layerId) this.toggleLayerProperty(layerId, 'above');
            });
        });

        // Move Up
        this.root.querySelectorAll('.layer-move-up').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const layerId = el.getAttribute('data-id');
                if (layerId) this.moveLayer(layerId, 'up');
            });
        });

        // Move Down
        this.root.querySelectorAll('.layer-move-down').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const layerId = el.getAttribute('data-id');
                if (layerId) this.moveLayer(layerId, 'down');
            });
        });

        // Rename
        this.root.querySelectorAll('.layer-rename').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const layerId = el.getAttribute('data-id');
                if (layerId) this.renameLayer(layerId);
            });
        });

        // Delete
        this.root.querySelectorAll('.layer-delete').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const layerId = el.getAttribute('data-id');
                if (layerId) this.deleteLayer(layerId);
            });
        });

        this.root.querySelectorAll('.mm-tool-btn[data-tool]').forEach(el => {
            el.addEventListener('click', () => {
                const tool = el.getAttribute('data-tool') as any;

                if ((tool === 'place' || tool === 'fill') && this.state.selectedTool === 'erase' && !this.state.selectedTileId) {
                    if (this.lastSelectedTileId && this.state.palette.find(p => p.id === this.lastSelectedTileId)) {
                        this.state.selectedTileId = this.lastSelectedTileId;
                    } else if (this.state.palette.length > 0) {
                        this.state.selectedTileId = this.state.palette[0].id;
                    }
                }

                this.state.selectedTool = tool;
                
                if (tool === 'fill') {
                    this.state.radius = 1;
                    this.state.diffusion = 100;
                } else if (tool === 'erase') {
                    this.state.selectedTileId = null;
                    this.state.diffusion = 100;
                }
                this.renderEditor();
                this.updateState();
            });
        });

        this.root.querySelectorAll('.mm-tool-btn[data-shape]').forEach(el => {
            el.addEventListener('click', () => {
                const shape = el.getAttribute('data-shape') as any;
                this.state.shape = shape;
                if (this.state.shape.startsWith('perlin')) {
                    this.state.diffusion = 40;
                }
                this.renderEditor();
                this.updateState();
            });
        });

        const regenBtn = this.root.querySelector('#mm-regen-noise-btn');
        if (regenBtn) {
            regenBtn.addEventListener('click', () => {
                window.dispatchEvent(new CustomEvent('mapmaker:regen-noise'));
            });
        }

        const radiusInput = this.root.querySelector('#mm-radius-input') as HTMLInputElement;
        if (radiusInput) {
            radiusInput.oninput = (e: any) => {
                this.state.radius = parseInt(e.target.value);
                this.root.querySelector('#mm-radius-val')!.textContent = this.state.radius.toString();
                this.updateState();
            };
        }

        const diffusionInput = this.root.querySelector('#mm-diffusion-input') as HTMLInputElement;
        if (diffusionInput) {
            diffusionInput.oninput = (e: any) => {
                this.state.diffusion = parseInt(e.target.value);
                this.root.querySelector('#mm-diffusion-val')!.textContent = this.state.diffusion + '%';
                this.updateState();
            };
        }

        this.root.querySelectorAll('.mm-tile-item').forEach(el => {
            el.addEventListener('contextmenu', (e: any) => {
                e.preventDefault();
                const id = el.getAttribute('data-id');
                const isLibrary = el.closest('#mm-library-list') !== null;
                if (id) this.handleTileContextMenu(e, id, isLibrary);
            });

            el.addEventListener('click', () => {
                const id = el.getAttribute('data-id');
                if (el.getAttribute('data-action') === 'add-to-palette') {
                    const tile = this.state.library.find(t => t.id === id);
                    if (tile && !this.state.palette.find(p => p.id === id)) {
                        this.state.palette.push(tile);
                        if (this.state.palette.length === 1) {
                            this.state.selectedTileId = tile.id;
                            this.lastSelectedTileId = tile.id;
                        }
                        this.renderEditor();
                        this.updateState();
                        this.saveMap();
                    }
                } else {
                    if (this.state.selectedTool === 'erase') {
                        this.state.selectedTool = 'place';
                    }
                    this.state.selectedTileId = id;
                    this.lastSelectedTileId = id;
                    this.renderEditor();
                    this.updateState();
                }
            });
        });

        (this.root.querySelector('#mm-save-btn') as HTMLElement).onclick = () => this.saveMap();
        (this.root.querySelector('#mm-exit-editor-btn') as HTMLElement).onclick = () => {
             history.pushState(null, '', '/maps/home');
             this.loadDashboard();
             window.dispatchEvent(new CustomEvent('mapmaker:close'));
        };
        (this.root.querySelector('#mm-upload-tile-btn') as HTMLElement).onclick = () => this.showUploadModal();

        const stateBtn = this.root.querySelector('#mm-state-btn') as HTMLElement;
        if (stateBtn) {
            stateBtn.onclick = () => this.toggleMapState();
        }

        window.addEventListener('mapmaker:saving', () => {
            const ind = this.root.querySelector('#mm-save-indicator');
            if (ind) {
                ind.classList.remove('mm-hidden');
                ind.innerHTML = '<div class="mm-save-dot"></div> Saving...';
            }
        });

        window.addEventListener('mapmaker:saved', () => {
            const ind = this.root.querySelector('#mm-save-indicator');
            if (ind) {
                ind.innerHTML = 'Saved';
                setTimeout(() => {
                    ind.classList.add('mm-hidden');
                }, 2000);
            }
        });

        window.addEventListener('mapmaker:preview', (e: any) => {
            const { layer, image } = e.detail;
            if (this.state.layerPreviews[layer] !== image) {
                this.state.layerPreviews[layer] = image;
                this.renderEditor();
            }
        });
    }

    private showToast(msg: string, duration = 3000) {
        let toast = document.querySelector('.mm-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'mm-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.classList.add('visible');
        setTimeout(() => toast.classList.remove('visible'), duration);
    }

    private async toggleMapState() {
        if (!this.state.currentMap) return;
        const newState = this.state.currentMap.state === MapState.DRAFT ? MapState.REVIEW : MapState.DRAFT;
        
        try {
            const res = await fetch(Config.getApiUrl(`/maps/${this.state.currentMap._id}/state`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state: newState })
            });
            const updated = await res.json();
            this.state.currentMap = updated;
            
            this.updateState();
            this.renderEditor();
            
            if (newState === MapState.REVIEW) {
                this.showToast('View Only Mode: Map is under review');
            } else {
                this.showToast('Edit Mode: Map is now editable');
            }
        } catch (e) {
            alert('Failed to update state');
        }
    }

    private showUploadModal() {
        const modal = document.createElement('div');
        modal.className = 'mm-modal-overlay mm-pointer-events-auto';
        modal.innerHTML = `
            <div class="mm-card" style="width: 800px; max-width: 95vw; height: 80vh; display:flex; flex-direction:column;">
                <span class="mm-close-btn"><i class="fa-solid fa-times"></i></span>
                <div style="display:flex; gap:1rem; border-bottom:1px solid #333; padding-bottom:0.5rem; margin-bottom:1rem;">
                    <button class="mm-tab-btn active" data-tab="single">Single Tile</button>
                    <button class="mm-tab-btn" data-tab="tilemap">Tilemap Slicer</button>
                </div>
                
                <div id="mm-tab-single" class="mm-tab-content" style="overflow-y:auto;">
                    <h3>Upload New Tile</h3>
                    <form id="mm-upload-form">
                        <label class="mm-label">Tile Name</label>
                        <input type="text" name="name" placeholder="e.g. Lava Rock" class="mm-input" required>
                        <label class="mm-label">Image File (32x32)</label>
                        <input type="file" name="image" accept="image/*" class="mm-input" required>
                        <div style="display:flex; gap:1rem;">
                            <div style="flex:1;">
                                <label class="mm-label">Movable</label>
                                <select name="movable" class="mm-select">
                                    <option value="false">No</option>
                                    <option value="true">Yes</option>
                                </select>
                            </div>
                        </div>
                        <div style="display:flex; gap:1rem;">
                             <div style="flex:1;">
                                <label class="mm-label">Speed Mult (1.0)</label>
                                <input type="number" name="speedMultiplier" value="1.0" step="0.1" class="mm-input">
                            </div>
                            <div style="flex:1;">
                                <label class="mm-label">Damage/Tick</label>
                                <input type="number" name="damagePerTick" value="0" class="mm-input">
                            </div>
                        </div>
                        <label class="mm-label">Behavior ID (Optional)</label>
                        <input type="text" name="behaviorId" placeholder="e.g. zombie_spawn" class="mm-input">
                        <button type="submit" class="mm-btn" style="margin-top:1rem;">Upload Tile</button>
                    </form>
                </div>
                
                <div id="mm-tab-tilemap" class="mm-tab-content" style="display:none; flex-direction:column;">
                    <div style="margin-bottom:1rem; display:flex; gap:1rem; align-items:center;">
                        <input type="file" id="mm-tilemap-file" accept="image/*" class="mm-input" style="width:auto;">
                        <span style="color:#888; font-size:0.8rem;">(Dimensions must be multiple of 32)</span>
                    </div>
                    <p style="color:#ccc; font-size:0.9rem; margin-top:-0.5rem; margin-bottom:1rem;">
                        <i class="fa-solid fa-info-circle"></i> Click to add a single tile, or drag to create a multi-tile structure. Click existing regions to edit.
                    </p>
                    <div style="flex:1; position:relative; overflow:auto; background:#111; border:1px solid #333; cursor:crosshair;" id="mm-slicer-container">
                        <canvas id="mm-slicer-canvas"></canvas>
                        <div id="mm-selection-box" style="position:absolute; border:2px solid #3a7bd5; background:rgba(58,123,213,0.2); pointer-events:none; display:none;"></div>
                    </div>
                    <div style="margin-top:1rem; display:flex; gap:1rem;">
                        <button id="mm-tilemap-done" class="mm-btn" disabled>Upload Selected</button>
                        <button id="mm-tilemap-drain" class="mm-btn" disabled>Drain Remaining & Upload</button>
                    </div>
                </div>
            </div>
        `;
        this.root.appendChild(modal);

        modal.querySelector('.mm-close-btn')!.addEventListener('click', () => modal.remove());

        // tab logic
        modal.querySelectorAll('.mm-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.mm-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.getAttribute('data-tab');
                (modal.querySelector('#mm-tab-single') as HTMLElement).style.display = tab === 'single' ? 'block' : 'none';
                (modal.querySelector('#mm-tab-tilemap') as HTMLElement).style.display = tab === 'tilemap' ? 'flex' : 'none';
            });
        });

        // 1 tile system
        const form = modal.querySelector('#mm-upload-form') as HTMLFormElement;
        form.onsubmit = async (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            try {
                const res = await fetch(Config.getApiUrl('/tiles'), { method: 'POST', body: formData });
                if (!res.ok) throw new Error((await res.json()).error);
                modal.remove();
                this.refreshLibrary();
            } catch (err: any) { alert('Upload failed: ' + err.message); }
        };

        // tilemap system
        this.initTilemapSlicer(modal);
    }

    private cloneFolder(folder: IFolder): IFolder {
        const newFolder: IFolder = {
            ...folder,
            id: 'folder_' + Date.now() + Math.floor(Math.random() * 1000).toString(),
            items: folder.items.map(i => {
                if ((i as any).itemType === 'folder') {
                    return this.cloneFolder(i as IFolder);
                } else {
                    return i;
                }
            })
        };
        return newFolder;
    }

    private addFolderToPalette(folderId: string) {
        const folder = this.findItemRecursive(this.state.library, folderId);
        if (!folder || folder.itemType !== 'folder') return;
        
        const clone = this.cloneFolder(folder);
        this.state.palette.push(clone);
        this.updateState();
        this.saveMap();
        this.renderEditor();
        this.showToast('Folder added to palette', 2000);
    }

    private handleFolderContextMenu(e: MouseEvent, folderId: string, listType: 'library' | 'palette') {
        // build menu
        const menu = document.createElement('div');
        menu.className = 'mm-context-menu';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';

        const addItem = (label: string, icon: string, action: () => void, isDanger = false) => {
            const item = document.createElement('div');
            item.className = 'mm-context-menu-item' + (isDanger ? ' danger' : '');
            item.innerHTML = `<i class="fa-solid fa-${icon}" style="width:20px;"></i> ${label}`;
            item.onclick = () => {
                action();
                menu.remove();
            };
            menu.appendChild(item);
        };
        
        // dismantle function
        addItem('Dismantle', 'box-open', () => {
             const list = listType === 'library' ? this.state.library : this.state.palette;
             const parentList = this.findParentList(list, folderId);
             const folder = this.findItemRecursive(list, folderId);
             
             if (parentList && folder) {
                 const idx = parentList.findIndex(x => x.id === folderId);
                 if (idx !== -1) {
                     parentList.splice(idx, 1, ...folder.items);
                     this.renderEditor();
                     this.updateState();
                     if (listType === 'library') this.saveLibrary(); else this.saveMap();
                 }
             }
        });

        if (listType === 'palette') {
             // rem all
             addItem('Remove (All)', 'trash', () => {
                 if (!confirm("Delete this folder and all its contents from the palette?")) return;
                 const parentList = this.findParentList(this.state.palette, folderId);
                 if (parentList) {
                     const idx = parentList.findIndex(x => x.id === folderId);
                     if (idx !== -1) {
                         parentList.splice(idx, 1);
                         this.renderEditor();
                         this.updateState();
                         this.saveMap();
                     }
                 }
             }, true);
        }

        document.body.appendChild(menu);
        
        const close = () => menu.remove();
        document.addEventListener('click', close, { once: true });
        menu.addEventListener('mouseleave', () => {
            document.addEventListener('mousedown', close, { once: true });
        });
    }

    private serializeStructure(list: any[]): any[] {
        return list.map(item => {
            if ((item as any).itemType === 'folder') {
                return {
                    ...item,
                    items: this.serializeStructure(item.items)
                };
            } else {
                return item.id;
            }
        });
    }

    private async saveLibrary() {
         const structure = this.serializeStructure(this.state.library);
         try {
             await fetch(Config.getApiUrl('/library'), {
                 method: 'POST', 
                 headers: {'Content-Type': 'application/json'},
                 body: JSON.stringify({ structure })
             });
         } catch(e) { console.error("Failed to save library order", e); }
    }

    private hydrateStructure(structure: any[], dataMap: Map<string, any>): any[] {
        const result: any[] = [];
        for (const item of structure) {
            if (typeof item === 'string') {
                const data = dataMap.get(item);
                if (data) result.push(data);
            } else if (item && item.itemType === 'folder') {
                const folder = { ...item };
                folder.items = this.hydrateStructure(folder.items || [], dataMap);
                result.push(folder);
            }
        }
        return result;
    }

    private async refreshLibrary() {
        try {
            const [tilesRes, groupsRes, libStructRes] = await Promise.all([
                fetch(Config.getApiUrl('/tiles')),
                fetch(Config.getApiUrl('/tile-groups')),
                fetch(Config.getApiUrl('/library')).catch(e => null)
            ]);

            const tiles = await tilesRes.json();
            const groups = groupsRes.ok ? await groupsRes.json() : [];
            tiles.forEach((t: any) => t.itemType = 'tile');
            groups.forEach((g: any) => g.itemType = 'group');
            
            const allItems = [...tiles, ...groups];
            const dataMap = new Map<string, any>();
            allItems.forEach(i => dataMap.set(i.id, i));
            
            let libStruct: any[] = [];
            if (libStructRes && libStructRes.ok) {
                libStruct = await libStructRes.json();
            }

            if (libStruct && libStruct.length > 0) {
                this.state.library = this.hydrateStructure(libStruct, dataMap);
                const used = new Set<string>();
                const collect = (l: any[]) => l.forEach(x => {
                    if(typeof x === 'string') used.add(x);
                    else if (x.itemType==='folder') collect(x.items);
                });
                collect(libStruct);
                
                const orphans = allItems.filter(i => !used.has(i.id));
                this.state.library.push(...orphans);
            } else {
                this.state.library = allItems;
            }

            // Inject System Tiles
            this.state.library.unshift({
                id: SYSTEM_TILES.INVISIBLE,
                name: 'Invisible Collision',
                itemType: 'tile',
                imageUrl: '' 
            } as any);

            this.state.library.unshift({
                id: SYSTEM_TILES.SPAWN,
                name: 'Spawn Point',
                itemType: 'tile',
                imageUrl: '' // Special render
            } as any);

            this.renderEditor();
            this.updateState();
        } catch(e) {
            console.error("Refresh Library Failed", e);
        }
    }

    private initTilemapSlicer(modal: HTMLElement) {
        const fileInput = modal.querySelector('#mm-tilemap-file') as HTMLInputElement;
        const canvas = modal.querySelector('#mm-slicer-canvas') as HTMLCanvasElement;
        const ctx = canvas.getContext('2d')!;
        const selectionBox = modal.querySelector('#mm-selection-box') as HTMLElement;
        const btnDone = modal.querySelector('#mm-tilemap-done') as HTMLButtonElement;
        const btnDrain = modal.querySelector('#mm-tilemap-drain') as HTMLButtonElement;
        
        let img: HTMLImageElement | null = null;
        let selectedRegions: { x: number, y: number, w: number, h: number, name: string }[] = [];
        let isDragging = false;
        let startX = 0, startY = 0;

        const draw = () => {
            if (!img) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let x = 0; x <= canvas.width; x += 32) { ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); }
            for (let y = 0; y <= canvas.height; y += 32) { ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); }
            ctx.stroke();

            selectedRegions.forEach(r => {
                ctx.fillStyle = 'rgba(58, 123, 213, 0.4)';
                ctx.strokeStyle = '#3a7bd5';
                ctx.lineWidth = 2;
                ctx.fillRect(r.x, r.y, r.w, r.h);
                ctx.strokeRect(r.x, r.y, r.w, r.h);
                
                const centerX = r.x + r.w / 2;
                const centerY = r.y + r.h / 2;
                ctx.fillStyle = 'white';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.font = '20px Arial'; 
                ctx.fillText('✎', centerX, centerY);
            });
        };

        fileInput.onchange = () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            img = new Image();
            img.onload = () => {
                if (img!.width % 32 !== 0 || img!.height % 32 !== 0) {
                    alert('Image dimensions must be multiple of 32');
                    img = null;
                    return;
                }
                canvas.width = img!.width;
                canvas.height = img!.height;
                draw();
                btnDone.disabled = false;
                btnDrain.disabled = false;
            };
            img.src = URL.createObjectURL(file);
        };

        canvas.onmousedown = (e) => {
            if (!img) return;
            const rect = canvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;
            
            // check if clicked inside existing region
            const existingIdx = selectedRegions.findIndex(r => 
                clickX >= r.x && clickX <= r.x + r.w && clickY >= r.y && clickY <= r.y + r.h
            );

            if (existingIdx !== -1) {
                const r = selectedRegions[existingIdx];
                const newName = prompt("Edit name:", r.name);
                if (newName !== null) {
                    r.name = newName;
                    draw();
                }
                return; 
            }

            startX = Math.floor((e.clientX - rect.left) / 32) * 32;
            startY = Math.floor((e.clientY - rect.top) / 32) * 32;
            isDragging = true;
            selectionBox.style.display = 'block';
            selectionBox.style.left = startX + 'px';
            selectionBox.style.top = startY + 'px';
            selectionBox.style.width = '32px';
            selectionBox.style.height = '32px';
        };

        canvas.onmousemove = (e) => {
            if (!isDragging) return;
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            const rawCurrX = Math.floor(mouseX / 32) * 32;
            const rawCurrY = Math.floor(mouseY / 32) * 32;
            
            const x1 = Math.min(startX, rawCurrX);
            const y1 = Math.min(startY, rawCurrY);
            const x2 = Math.max(startX + 32, rawCurrX + 32);
            const y2 = Math.max(startY + 32, rawCurrY + 32);
            
            const w = x2 - x1;
            const h = y2 - y1;
            
            selectionBox.style.left = x1 + 'px';
            selectionBox.style.top = y1 + 'px';
            selectionBox.style.width = w + 'px';
            selectionBox.style.height = h + 'px';
        };

        canvas.onmouseup = () => {
            if (!isDragging) return;
            isDragging = false;
            selectionBox.style.display = 'none';
            
            const x = parseInt(selectionBox.style.left);
            const y = parseInt(selectionBox.style.top);
            const w = parseInt(selectionBox.style.width);
            const h = parseInt(selectionBox.style.height);
            
            const name = prompt("Enter name for this " + (w > 32 || h > 32 ? "Group" : "Tile"));
            if (name) {
                selectedRegions.push({ x, y, w, h, name });
                draw();
            }
        };

        const uploadRegion = async (r: { x: number, y: number, w: number, h: number, name: string }) => {
            // slice
            if (r.w === 32 && r.h === 32) {
                const blob = await slice(r.x, r.y, 32, 32);
                await uploadTile(blob, r.name);
            } else {
                const tilesData = [];
                for (let y = 0; y < r.h; y += 32) {
                    for (let x = 0; x < r.w; x += 32) {
                        const blob = await slice(r.x + x, r.y + y, 32, 32);
                        const tile = await uploadTile(blob, `${r.name}_${x/32}_${y/32}`, true);
                        tilesData.push({ x: x/32, y: y/32, tileId: tile.id });
                    }
                }
                const previewBlob = await slice(r.x, r.y, r.w, r.h);
                await uploadGroup(r.name, tilesData, previewBlob);
            }
        };

        const slice = (x: number, y: number, w: number, h: number): Promise<Blob> => {
            const tCanvas = document.createElement('canvas');
            tCanvas.width = w; tCanvas.height = h;
            const tCtx = tCanvas.getContext('2d')!;
            tCtx.drawImage(img!, x, y, w, h, 0, 0, w, h);
            return new Promise(resolve => tCanvas.toBlob(b => resolve(b!)));
        };

        const uploadTile = async (blob: Blob, name: string, hidden: boolean = false) => {
            const fd = new FormData();
            fd.append('image', blob, name + '.png');
            fd.append('name', name);
            if (hidden) fd.append('hidden', 'true');
            const res = await fetch(Config.getApiUrl('/tiles'), { method: 'POST', body: fd });
            if (!res.ok) throw new Error('Upload failed');
            return await res.json();
        };

        const uploadGroup = async (name: string, tiles: any[], preview: Blob) => {
            const fd = new FormData();
            fd.append('preview', preview, name + '_preview.png');
            fd.append('name', name);
            fd.append('tiles', JSON.stringify(tiles));
            const res = await fetch(Config.getApiUrl('/tile-groups'), { method: 'POST', body: fd });
            if (!res.ok) throw new Error('Group upload failed');
        };

        const processUpload = async (drain: boolean) => {
            if (!img) return;
            
            // if drain, add non-selected regions
            if (drain) {
                const occupied = new Set<string>();
                selectedRegions.forEach(r => {
                    for(let y=r.y; y<r.y+r.h; y+=32) 
                        for(let x=r.x; x<r.x+r.w; x+=32) 
                            occupied.add(`${x},${y}`);
                });

                // scan grid
                const tmpC = document.createElement('canvas');
                tmpC.width = 32; tmpC.height = 32;
                const tmpCtx = tmpC.getContext('2d')!;

                for(let y=0; y<img.height; y+=32) {
                    for(let x=0; x<img.width; x+=32) {
                        if (occupied.has(`${x},${y}`)) continue;
                        
                        // check transparent/empty
                        tmpCtx.clearRect(0,0,32,32);
                        tmpCtx.drawImage(img, x, y, 32, 32, 0, 0, 32, 32);
                        const data = tmpCtx.getImageData(0,0,32,32).data;
                        let hasContent = false;
                        for(let i=3; i<data.length; i+=4) {
                            if (data[i] > 0) { hasContent = true; break; }
                        }
                        
                        if (hasContent) {
                            const fileName = fileInput.files![0].name.split('.')[0];
                            selectedRegions.push({ x, y, w: 32, h: 32, name: `${fileName}_${x}_${y}` });
                        }
                    }
                }
            }

            try {
                // upload all
                for (const r of selectedRegions) {
                    await uploadRegion(r);
                }
                modal.remove();
                this.refreshLibrary();
            } catch (e: any) {
                alert("Error during processing: " + e.message);
            }
        };

        btnDone.onclick = () => processUpload(false);
        btnDrain.onclick = () => processUpload(true);
    }

    private updateState() {
        this.onStateChange?.(this.state);
    }

    private async saveMap() {
        window.dispatchEvent(new CustomEvent('mapmaker:save'));
    }
    
    public updateMapData(mapData: IMap) {
        this.state.currentMap = mapData;
    }

    private findItemRecursive(list: any[], id: string): any {
        for (const item of list) {
            if (item.id === id) return item;
            if (item.itemType === 'folder' && item.items) {
                const found = this.findItemRecursive(item.items, id);
                if (found) return found;
            }
        }
        return null;
    }

    private showCreateFolderModal(listType: 'library' | 'palette') {
        const modal = document.createElement('div');
        modal.className = 'mm-login-overlay mm-pointer-events-auto';
        modal.innerHTML = `
            <div class="mm-card" style="width: 300px;">
                <h3>Create Folder</h3>
                <div style="margin-bottom:1rem;">
                    <label class="mm-label">Folder Name</label>
                    <input type="text" id="mm-folder-name" class="mm-input" placeholder="e.g., Outdoors" autofocus>
                </div>
                <div style="margin-bottom:1rem;">
                    <label class="mm-label">Color</label>
                    <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                        ${['#3a7bd5', '#d53a3a', '#3ad57b', '#d5d53a', '#d53ad5', '#3ad5d5'].map(c => `
                            <div class="mm-color-swatch ${c === '#3a7bd5' ? 'active' : ''}" 
                                 data-color="${c}" 
                                 style="width:24px; height:24px; background:${c}; cursor:pointer; border:2px solid transparent; border-radius:50%;"></div>
                        `).join('')}
                    </div>
                </div>
                <div style="margin-bottom:1rem;">
                    <label class="mm-label">Icon</label>
                    <div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:0.5rem; max-height:100px; overflow-y:auto;">
                        ${['folder', 'tree', 'mountain', 'house', 'dungeon', 'water', 'fire', 'skull', 'gem', 'star'].map(i => `
                            <div class="mm-icon-option ${i === 'folder' ? 'active' : ''}" 
                                 data-icon="${i}" 
                                 style="width:32px; height:32px; display:flex; align-items:center; justify-content:center; cursor:pointer; border:1px solid #333; border-radius:4px; color:white;">
                                <i class="fa-solid fa-${i}"></i>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div style="display:flex; justify-content:flex-end; gap:0.5rem;">
                    <button class="mm-btn mm-btn-secondary" id="mm-cancel-folder">Cancel</button>
                    <button class="mm-btn" id="mm-confirm-folder">Create</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        let selectedColor = '#3a7bd5';
        let selectedIcon = 'folder';

        modal.querySelectorAll('.mm-color-swatch').forEach(el => {
            el.addEventListener('click', () => {
                modal.querySelectorAll('.mm-color-swatch').forEach(c => (c as HTMLElement).style.borderColor = 'transparent');
                (el as HTMLElement).style.borderColor = 'white';
                selectedColor = el.getAttribute('data-color')!;
            });
        });
        
        // init color selection visually
        (modal.querySelector('.mm-color-swatch') as HTMLElement).style.borderColor = 'white';

        modal.querySelectorAll('.mm-icon-option').forEach(el => {
            el.addEventListener('click', () => {
                modal.querySelectorAll('.mm-icon-option').forEach(i => (i as HTMLElement).style.background = 'transparent');
                (el as HTMLElement).style.background = '#444';
                selectedIcon = el.getAttribute('data-icon')!;
            });
        });
        
        // init icon selection visually
        (modal.querySelector('.mm-icon-option') as HTMLElement).style.background = '#444';

        const close = () => modal.remove();
        
        modal.querySelector('#mm-cancel-folder')!.addEventListener('click', close);
        modal.querySelector('#mm-confirm-folder')!.addEventListener('click', () => {
            const name = (modal.querySelector('#mm-folder-name') as HTMLInputElement).value;
            if (!name) return;

            const folder: IFolder = {
                itemType: 'folder',
                id: 'folder_' + Date.now(),
                name,
                color: selectedColor,
                icon: selectedIcon,
                items: [],
                collapsed: true
            };

            if (listType === 'library') {
                this.state.library.unshift(folder);
                this.saveLibrary();
            } else {
                this.state.palette.unshift(folder);
                this.updateState();
                this.saveMap();
            }
            
            this.renderEditor();
            close();
        });
    }

    private findParentList(list: any[], id: string): any[] | null {
        if (list.some(i => i.id === id)) return list;
        for (const item of list) {
            if (item.itemType === 'folder' && item.items) {
                const found = this.findParentList(item.items, id);
                if (found) return found;
            }
        }
        return null;
    }

    private bindDragDropEvents() {
        // drag start
        this.root.querySelectorAll('[draggable="true"]').forEach(el => {
            el.addEventListener('dragstart', (e: any) => {
                const id = el.getAttribute('data-id');
                const list = el.getAttribute('data-list') as 'library' | 'palette';
                // find item
                const sourceArray = list === 'library' ? this.state.library : this.state.palette;
                if (!id) return;
                const item = this.findItemRecursive(sourceArray, id);
                
                if (item) {
                    this.state.draggingItem = { item, sourceList: list };
                    e.dataTransfer.effectAllowed = 'move';
                    // firefox support
                    e.dataTransfer.setData('text/plain', id);
                    el.classList.add('mm-dragging');
                }
            });

            el.addEventListener('dragend', () => {
                el.classList.remove('mm-dragging');
                this.state.draggingItem = null;
                this.root.querySelectorAll('.mm-drop-target').forEach(t => t.classList.remove('mm-drop-target'));
                this.root.querySelectorAll('.mm-drop-before').forEach(t => t.classList.remove('mm-drop-before'));
                this.root.querySelectorAll('.mm-drop-after').forEach(t => t.classList.remove('mm-drop-after'));
            });
        });

        const handleMoveLogic = (targetId: string, targetListType: string, action: 'before' | 'after' | 'into') => {
             const dragging = this.state.draggingItem;
             if (!dragging) return;
             if (dragging.sourceList !== targetListType) return;
             if (dragging.item.id === targetId) return;

             const rootList = targetListType === 'library' ? this.state.library : this.state.palette;

             // remove from old location
             const oldParentList = this.findParentList(rootList, dragging.item.id);
             if (!oldParentList) return; 

             const oldIdx = oldParentList.findIndex(x => x.id === dragging.item.id);
             if (oldIdx !== -1) oldParentList.splice(oldIdx, 1);

             // insert
             if (action === 'into') {
                 const folder = this.findItemRecursive(rootList, targetId);
                 if (folder && folder.itemType === 'folder') {
                     folder.items.push(dragging.item);
                     folder.collapsed = false;
                 } else {
                     oldParentList.splice(oldIdx, 0, dragging.item);
                 }
             } else {
                 const newParentList = this.findParentList(rootList, targetId);
                 if (newParentList) {
                     const targetIdx = newParentList.findIndex(x => x.id === targetId);
                     if (targetIdx !== -1) {
                         const insertIdx = action === 'after' ? targetIdx + 1 : targetIdx;
                         newParentList.splice(insertIdx, 0, dragging.item);
                     } else {
                         oldParentList.splice(oldIdx, 0, dragging.item);
                     }
                 } else {
                     oldParentList.splice(oldIdx, 0, dragging.item);
                 }
             }
             this.renderEditor();
             this.updateState();
             if (targetListType === 'library') this.saveLibrary();
             else this.saveMap();
        };

        this.root.querySelectorAll('.mm-folder-header').forEach(el => {
             const container = el.parentElement as HTMLElement;
             if (!container) return;

             el.addEventListener('dragover', (e: any) => {
                 e.preventDefault(); e.stopPropagation();
                 if (!this.state.draggingItem) return;

                 const rect = container.getBoundingClientRect();
                 const relY = e.clientY - rect.top;
                 const h = rect.height;

                 container.classList.remove('mm-drop-before', 'mm-drop-after', 'mm-drop-target');

                 if (relY < h * 0.25) {
                     container.classList.add('mm-drop-before');
                 } else if (relY > h * 0.75) {
                     container.classList.add('mm-drop-after');
                 } else {
                     container.classList.add('mm-drop-target');
                 }
                 e.dataTransfer.dropEffect = 'move';
             });
             
             el.addEventListener('dragleave', () => {
                 container.classList.remove('mm-drop-before', 'mm-drop-after', 'mm-drop-target');
             });

             el.addEventListener('drop', (e: any) => {
                 e.preventDefault(); e.stopPropagation();
                 container.classList.remove('mm-drop-before', 'mm-drop-after', 'mm-drop-target');
                 
                 const targetId = container.getAttribute('data-id');
                 const targetList = container.getAttribute('data-list');
                 if (!targetId || !targetList) return;

                 const rect = container.getBoundingClientRect();
                 const relY = e.clientY - rect.top;
                 const h = rect.height;
                 
                 let action: 'before'|'after'|'into' = 'into';
                 if (relY < h * 0.25) action = 'before';
                 else if (relY > h * 0.75) action = 'after';
                 
                 handleMoveLogic(targetId, targetList, action);
             });
        });

        this.root.querySelectorAll('.mm-tile-item').forEach(el => {
             el.addEventListener('dragover', (e: any) => {
                 e.preventDefault(); e.stopPropagation();
                 if (!this.state.draggingItem) return;

                 const rect = el.getBoundingClientRect();
                 const relY = e.clientY - rect.top;
                 const h = rect.height;

                 el.classList.remove('mm-drop-before', 'mm-drop-after');
                 if (relY < h * 0.5) el.classList.add('mm-drop-before');
                 else el.classList.add('mm-drop-after');
                 
                 e.dataTransfer.dropEffect = 'move';
             });

             el.addEventListener('dragleave', () => {
                 el.classList.remove('mm-drop-before', 'mm-drop-after');
             });

             el.addEventListener('drop', (e: any) => {
                 e.preventDefault(); e.stopPropagation();
                 el.classList.remove('mm-drop-before', 'mm-drop-after');
                 
                 const targetId = el.getAttribute('data-id');
                 const targetList = el.getAttribute('data-list');
                 if (!targetId || !targetList) return;

                 const rect = el.getBoundingClientRect();
                 const relY = e.clientY - rect.top;
                 const h = rect.height;
                 
                 const action = (relY < h * 0.5) ? 'before' : 'after';
                 handleMoveLogic(targetId, targetList, action);
             });
        });

        this.root.querySelectorAll('.mm-folder-container, .mm-drop-zone-placeholder').forEach(el => {

            if (!el.classList.contains('mm-drop-zone-placeholder')) return;

            el.addEventListener('dragover', (e: any) => {
                e.preventDefault(); e.stopPropagation();
                 if (!this.state.draggingItem) return;
                el.classList.add('mm-drop-target');
            });
            el.addEventListener('dragleave', () => el.classList.remove('mm-drop-target'));
            el.addEventListener('drop', (e: any) => {
                e.preventDefault(); e.stopPropagation();
                el.classList.remove('mm-drop-target');
                
                const targetFolderId = el.getAttribute('data-folder-id');
                const targetList = el.getAttribute('data-list'); // library or palette
                if (!targetList) return;
                
                const dragging = this.state.draggingItem;
                if (!dragging || dragging.sourceList !== targetList) return;

                const rootList = targetList === 'library' ? this.state.library : this.state.palette;
                const oldParent = this.findParentList(rootList, dragging.item.id);
                if (oldParent) {
                     const idx = oldParent.findIndex(x => x.id === dragging.item.id);
                     if (idx !== -1) oldParent.splice(idx, 1);
                }

                if (targetFolderId) {
                    const folder = this.findItemRecursive(rootList, targetFolderId);
                    if (folder) folder.items.push(dragging.item);
                } else {
                    rootList.push(dragging.item);
                }
                this.renderEditor();
                this.updateState();
                if (targetList === 'library') this.saveLibrary();
                else this.saveMap();
            });
        });
    }

    private removeItemRecursive(list: any[], id: string): boolean {
        const idx = list.findIndex(i => i.id === id);
        if (idx !== -1) {
            list.splice(idx, 1);
            return true;
        }
        for (const item of list) {
            if (item.itemType === 'folder' && item.items) {
                if (this.removeItemRecursive(item.items, id)) return true;
            }
        }
        return false;
    }
}
