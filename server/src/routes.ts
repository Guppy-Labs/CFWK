import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { Tile } from "./models/Tile";
import { TileGroup } from "./models/TileGroup";
import { MapModel } from "./models/Map";
import { Library } from "./models/Library";
import { MapState, MapLayer } from "@cfwk/shared";

const router = express.Router();

const removeIdFromStructure = (list: any[], id: string): boolean => {
    let changed = false;
    if (!Array.isArray(list)) return false;
    for (let i = list.length - 1; i >= 0; i--) {
        const item = list[i];
        if (typeof item === 'string') {
            if (item === id) {
                list.splice(i, 1);
                changed = true;
            }
        } else if (item && item.itemType === 'folder' && Array.isArray(item.items)) {
            if (removeIdFromStructure(item.items, id)) changed = true;
        }
    }
    return changed;
};

// --- File Upload Setup ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, "../uploads/tiles");
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const name = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
        cb(null, Date.now() + "_" + name);
    }
});

const upload = multer({ storage });

// --- Tile API ---
router.post("/tiles", upload.single("image"), async (req, res) => {
    try {
        if (!req.file && !req.body.imageUrl) {
            return res.status(400).json({ error: "No image file provided" });
        }

        const { name, movable, speedMultiplier, damagePerTick, behaviorId, imageUrl, hidden } = req.body;
        
        let tileId = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
        if (req.body.tileId) tileId = req.body.tileId;

        const existing = await Tile.findOne({ tileId });
        if (existing) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(409).json({ error: "Tile ID already exists" });
        }

        const tile = new Tile({
            tileId,
            name,
            imageUrl: req.file ? `/uploads/tiles/${req.file.filename}` : imageUrl,
            movable: movable === 'true' || movable === true,
            speedMultiplier: parseFloat(speedMultiplier) || 1.0,
            damagePerTick: parseFloat(damagePerTick) || 0,
            behaviorId,
            hidden: hidden === 'true' || hidden === true
        });

        await tile.save();
        res.json(tile);
    } catch (e: any) {
        console.error("Upload error:", e);
        res.status(500).json({ error: e.message });
    }
});

router.get("/tiles", async (req, res) => {
    try {
        const tiles = await Tile.find().sort({ name: 1 });
        res.json(tiles);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.put("/tiles/:id", async (req, res) => {
    try {
        const { name, movable, speedMultiplier, damagePerTick, behaviorId } = req.body;
        const tile = await Tile.findOne({ tileId: req.params.id });
        if (!tile) return res.status(404).json({ error: "Tile not found" });

        if (name) tile.name = name;
        if (movable !== undefined) tile.movable = movable;
        if (speedMultiplier !== undefined) tile.speedMultiplier = speedMultiplier;
        if (damagePerTick !== undefined) tile.damagePerTick = damagePerTick;
        if (behaviorId !== undefined) tile.behaviorId = behaviorId;

        await tile.save();
        res.json(tile);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.delete("/tiles/:id", async (req, res) => {
    try {
        const tileId = req.params.id;
        const tile = await Tile.findOne({ tileId });
        if (!tile) return res.status(404).json({ error: "Tile not found" });

        try {
            const filePath = path.join(__dirname, "..", tile.imageUrl);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (err) { console.error("File delete error", err); }

        await Tile.deleteOne({ tileId });

        const library = await Library.findOne();
        if (library && Array.isArray(library.structure)) {
             if (removeIdFromStructure(library.structure, tileId)) {
                 library.markModified('structure');
                 await library.save();
             }
        }

        const maps = await MapModel.find({});
        for (const map of maps) {
            let changed = false;
            if (map.palette && Array.isArray(map.palette)) {
                if (removeIdFromStructure(map.palette as any[], tileId)) {
                    map.markModified('palette');
                    changed = true;
                }
            }
            
            const layerKeys = Object.values(MapLayer);
            for (const key of layerKeys) {
                const layer = map.layers[key] as any;
                if (layer) {
                    const coords = Array.from(layer.keys());
                    for (const coord of coords) {
                        if (layer.get(coord) === tileId) {
                            layer.delete(coord);
                            changed = true;
                        }
                    }
                }
            }
            
            if (changed) await map.save();
        }

        res.json({ success: true });
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// --- Tile Group API ---
router.post("/tile-groups", upload.single("preview"), async (req, res) => {
    try {
        const { name, tiles } = req.body;
        const tilesData = typeof tiles === 'string' ? JSON.parse(tiles) : tiles;
        
        const groupId = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
        
        const existing = await TileGroup.findOne({ groupId });
        if (existing) return res.status(409).json({ error: "Group ID exists" });

        const group = new TileGroup({
            groupId,
            name,
            tiles: tilesData,
            previewUrl: req.file ? `/uploads/tiles/${req.file.filename}` : undefined
        });
        
        await group.save();
        res.json(group);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.get("/tile-groups", async (req, res) => {
    try {
        const groups = await TileGroup.find().sort({ name: 1 });
        res.json(groups);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.delete("/tile-groups/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const group = await TileGroup.findOne({ groupId: id });
        if (!group) return res.status(404).json({ error: "Group not found" });
        for (const t of group.tiles) {
             const tile = await Tile.findOne({ tileId: t.tileId });
             if (tile && tile.hidden) {
                 await Tile.deleteOne({ tileId: t.tileId });
             }
        }

        await TileGroup.deleteOne({ groupId: id });
        if (group.previewUrl) {
            const previewPath = path.join(__dirname, `..${group.previewUrl}`);
            if (fs.existsSync(previewPath)) {
                fs.unlinkSync(previewPath);
            }
        }

        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// --- Library API ---
router.get("/library", async (req, res) => {
    try {
        let library = await Library.findOne();
        if (!library) {
            library = new Library({ structure: [] });
            await library.save();
        }
        res.json(library.structure);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post("/library", async (req, res) => {
    try {
        const { structure } = req.body;
        
        let library = await Library.findOne();
        if (!library) library = new Library({});
        
        library.structure = structure || [];
        await library.save();
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// --- Map API ---
router.post("/maps", async (req, res) => {
    try {
        const { name, width, height } = req.body;
        const map = new MapModel({
            name: name || "New Map",
            width: width || 20,
            height: height || 20,
            state: MapState.DRAFT,
            layers: {
                background: {},
                ground: {},
                wall: {},
                deco: {},
                object: {}
            }
        });
        await map.save();
        res.json(map);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.get("/maps", async (req, res) => {
    try {
        const { state } = req.query;
        const query = state ? { state } : {};
        const maps = await MapModel.find(query).sort({ updatedAt: -1 });
        res.json(maps);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.get("/maps/:id", async (req, res) => {
    try {
        const map = await MapModel.findById(req.params.id);
        if (!map) return res.status(404).json({ error: "Map not found" });
        res.json(map);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.put("/maps/:id", async (req, res) => {
    try {
        const { layers, width, height, palette } = req.body;

        const map = await MapModel.findById(req.params.id);
        if (!map) return res.status(404).json({ error: "Map not found" });
        
        if (map.state !== MapState.DRAFT) {
            return res.status(403).json({ error: "Only draft maps can be edited" });
        }

        map.layers = layers;
        if (palette) map.palette = palette;
        if (width) map.width = width;
        if (height) map.height = height;
        
        await map.save();
        res.json(map);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.put("/maps/:id/state", async (req, res) => {
    try {
        const { state } = req.body;
        const map = await MapModel.findByIdAndUpdate(
            req.params.id, 
            { state }, 
            { new: true }
        );
        if (!map) return res.status(404).json({ error: "Map not found" });
        res.json(map);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;

