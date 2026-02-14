import mongoose, { Schema, Document } from 'mongoose';
import {
  ICharacterAppearance,
  DEFAULT_CHARACTER_APPEARANCE,
  DEFAULT_USER_SETTINGS,
  IUserSettings,
  DEFAULT_INVENTORY_SLOTS,
  getItemDefinition,
  IPlayerStats,
  DEFAULT_PLAYER_STATS
} from '@cfwk/shared';

// Re-export for convenience
export { ICharacterAppearance, DEFAULT_CHARACTER_APPEARANCE };

export interface IUser extends Document {
  username?: string;
  email: string;
  password?: string;
  googleId?: string;
  discordId?: string;
  profilePic?: string;
  status?: string;
  createdAt: Date;
  lastUsernameChange?: Date;
  permissions: string[];
  isVerified: boolean;
  verificationToken?: string;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  lastPasswordResetRequest?: Date;
  bannedUntil?: Date;
  mutedUntil?: Date;
  lastKnownIP?: string;
  inventory?: { index: number; itemId: string | null; count: number }[];
  equippedRodId?: string | null;
  characterAppearance?: ICharacterAppearance;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  premiumStatus?: string; // active, past_due, canceled, etc
  premiumTier?: 'shark' | null;
  premiumCurrentPeriodEnd?: Date;
  betaAccessUntil?: Date | null;
  settings?: IUserSettings;
  playerStats?: IPlayerStats;
}

type RawInventoryEntry = { index?: number; itemId?: string | null; count?: number };
type NormalizedInventoryEntry = { index: number; itemId: string | null; count: number };

function createEmptySlots(count: number): NormalizedInventoryEntry[] {
  return Array.from({ length: count }, (_v, index) => ({ index, itemId: null, count: 0 }));
}

function getStackSize(itemId: string): number {
  const def = getItemDefinition(itemId);
  return def?.stackSize ?? 99;
}

function placeItemInSlots(slots: NormalizedInventoryEntry[], itemId: string, amount: number) {
  const stackSize = getStackSize(itemId);
  let remaining = amount;

  for (const slot of slots) {
    if (remaining <= 0) break;
    if (slot.itemId !== itemId) continue;
    if (slot.count >= stackSize) continue;

    const canAdd = Math.min(stackSize - slot.count, remaining);
    slot.count += canAdd;
    remaining -= canAdd;
  }

  for (const slot of slots) {
    if (remaining <= 0) break;
    if (slot.itemId !== null) continue;

    const toAdd = Math.min(stackSize, remaining);
    slot.itemId = itemId;
    slot.count = toAdd;
    remaining -= toAdd;
  }
}

function normalizeInventoryForSave(rawInventory: RawInventoryEntry[]): NormalizedInventoryEntry[] {
  if (rawInventory.length === 0) return [];
  const isLegacy = rawInventory.some((slot) => slot.index === undefined);

  if (isLegacy) {
    const slots = createEmptySlots(DEFAULT_INVENTORY_SLOTS);
    for (const entry of rawInventory) {
      const itemId = entry.itemId ?? null;
      const count = Math.max(0, entry.count ?? 0);
      if (!itemId || count <= 0) continue;
      placeItemInSlots(slots, itemId, count);
    }
    return slots;
  }

  const slots: NormalizedInventoryEntry[] = rawInventory
    .map((slot, index) => ({
      index: slot.index ?? index,
      itemId: slot.itemId ?? null,
      count: Math.max(0, slot.count ?? 0)
    }))
    .sort((a, b) => a.index - b.index);

  if (slots.length < DEFAULT_INVENTORY_SLOTS) {
    const start = slots.length;
    for (let i = start; i < DEFAULT_INVENTORY_SLOTS; i += 1) {
      slots.push({ index: i, itemId: null, count: 0 });
    }
  }

  return slots;
}

const UserSchema: Schema = new Schema({
  username: { type: String, unique: true, sparse: true },
  email: { type: String, required: true, unique: true },
  password: { type: String },
  googleId: { type: String, unique: true, sparse: true },
  discordId: { type: String, unique: true, sparse: true },
  profilePic: { type: String },
  status: { type: String, maxlength: 100 },
  lastUsernameChange: { type: Date },
  permissions: { type: [String], default: [] },
  isVerified: { type: Boolean, default: false },
  verificationToken: { type: String },
  passwordResetToken: { type: String },
  passwordResetExpires: { type: Date },
  lastPasswordResetRequest: { type: Date },
  bannedUntil: { type: Date, default: null },
  mutedUntil: { type: Date, default: null },
  lastKnownIP: { type: String },
  inventory: {
    type: [
      {
        index: { type: Number, required: true },
        itemId: { type: String, default: null },
        count: { type: Number, required: true, default: 0 }
      }
    ],
    default: []
  },
  equippedRodId: { type: String, default: null },
  characterAppearance: {
    type: {
      body: {
        hueShift: { type: Number, default: 0 },
        brightnessShift: { type: Number, default: 0 }
      },
      head: {
        hueShift: { type: Number, default: 0 },
        brightnessShift: { type: Number, default: 0 }
      },
      accessories: {
        neck: {
          itemId: { type: String, default: 'scarf' },
          equipped: { type: Boolean, default: true },
          hueShift: { type: Number, default: 0 },
          brightnessShift: { type: Number, default: 0 }
        },
        cape: {
          itemId: { type: String, default: 'cape' },
          equipped: { type: Boolean, default: true },
          hueShift: { type: Number, default: 0 },
          brightnessShift: { type: Number, default: 0 }
        }
      }
    },
    default: () => ({ ...DEFAULT_CHARACTER_APPEARANCE })
  },
  stripeCustomerId: { type: String },
  stripeSubscriptionId: { type: String },
  premiumStatus: { type: String },
  premiumTier: { type: String, default: null },
  premiumCurrentPeriodEnd: { type: Date },
  betaAccessUntil: { type: Date, default: null },
  settings: {
    type: {
      language: { type: String, default: DEFAULT_USER_SETTINGS.language },
      audio: {
        master: { type: Number, default: DEFAULT_USER_SETTINGS.audio.master },
        music: { type: Number, default: DEFAULT_USER_SETTINGS.audio.music },
        ambient: { type: Number, default: DEFAULT_USER_SETTINGS.audio.ambient },
        players: { type: Number, default: DEFAULT_USER_SETTINGS.audio.players },
        overlays: { type: Number, default: DEFAULT_USER_SETTINGS.audio.overlays },
        subtitlesEnabled: { type: Boolean, default: DEFAULT_USER_SETTINGS.audio.subtitlesEnabled },
        stereoEnabled: { type: Boolean, default: DEFAULT_USER_SETTINGS.audio.stereoEnabled }
      },
      video: {
        qualityPreset: { type: String, default: DEFAULT_USER_SETTINGS.video.qualityPreset },
        fullscreen: { type: Boolean, default: DEFAULT_USER_SETTINGS.video.fullscreen },
        visualEffectsEnabled: { type: Boolean, default: DEFAULT_USER_SETTINGS.video.visualEffectsEnabled },
        seasonalEffectsEnabled: { type: Boolean, default: DEFAULT_USER_SETTINGS.video.seasonalEffectsEnabled },
        bloomEnabled: { type: Boolean, default: DEFAULT_USER_SETTINGS.video.bloomEnabled },
        vignetteEnabled: { type: Boolean, default: DEFAULT_USER_SETTINGS.video.vignetteEnabled },
        tiltShiftEnabled: { type: Boolean, default: DEFAULT_USER_SETTINGS.video.tiltShiftEnabled },
        dustParticlesEnabled: { type: Boolean, default: DEFAULT_USER_SETTINGS.video.dustParticlesEnabled }
      },
      controls: {
        moveUp: { type: String, default: DEFAULT_USER_SETTINGS.controls.moveUp },
        moveLeft: { type: String, default: DEFAULT_USER_SETTINGS.controls.moveLeft },
        moveDown: { type: String, default: DEFAULT_USER_SETTINGS.controls.moveDown },
        moveRight: { type: String, default: DEFAULT_USER_SETTINGS.controls.moveRight },
        sprint: { type: String, default: DEFAULT_USER_SETTINGS.controls.sprint },
        interact: { type: String, default: DEFAULT_USER_SETTINGS.controls.interact },
        inventory: { type: String, default: DEFAULT_USER_SETTINGS.controls.inventory },
        fish: { type: String, default: DEFAULT_USER_SETTINGS.controls.fish },
        playerList: { type: String, default: DEFAULT_USER_SETTINGS.controls.playerList },
        chat: { type: String, default: DEFAULT_USER_SETTINGS.controls.chat },
        dialogueAdvance: { type: String, default: DEFAULT_USER_SETTINGS.controls.dialogueAdvance }
      }
    },
    default: () => ({
      language: DEFAULT_USER_SETTINGS.language,
      audio: { ...DEFAULT_USER_SETTINGS.audio },
      video: { ...DEFAULT_USER_SETTINGS.video },
      controls: { ...DEFAULT_USER_SETTINGS.controls }
    })
  },
  playerStats: {
    type: {
      distanceWalked: { type: Number, default: DEFAULT_PLAYER_STATS.distanceWalked },
      distanceRan: { type: Number, default: DEFAULT_PLAYER_STATS.distanceRan },
      timeOnlineMs: { type: Number, default: DEFAULT_PLAYER_STATS.timeOnlineMs },
      catches: { type: Number, default: DEFAULT_PLAYER_STATS.catches },
      npcInteractions: { type: Number, default: DEFAULT_PLAYER_STATS.npcInteractions }
    },
    default: () => ({ ...DEFAULT_PLAYER_STATS })
  }
}, {
  timestamps: true
});

UserSchema.index({ 'playerStats.distanceWalked': -1 });
UserSchema.index({ 'playerStats.distanceRan': -1 });
UserSchema.index({ 'playerStats.timeOnlineMs': -1 });
UserSchema.index({ 'playerStats.catches': -1 });
UserSchema.index({ 'playerStats.npcInteractions': -1 });

UserSchema.pre('validate', function (next) {
  const doc = this as IUser;
  if (!Array.isArray(doc.inventory) || doc.inventory.length === 0) {
    next();
    return;
  }

  const needsNormalize = doc.inventory.some((slot: RawInventoryEntry) => slot.index === undefined);
  if (needsNormalize) {
    doc.inventory = normalizeInventoryForSave(doc.inventory as RawInventoryEntry[]);
  }

  next();
});

export default mongoose.model<IUser>('User', UserSchema);
