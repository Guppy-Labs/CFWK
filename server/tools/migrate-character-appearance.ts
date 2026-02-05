import mongoose from 'mongoose';
import User from '../src/models/User';

const MONGO_URI = "mongodb+srv://admin:ariesmongo123@ariesdb.cbmjd5h.mongodb.net/cfwk";

if (!MONGO_URI) {
    console.error('[migrate-character-appearance] MONGO_URI is not set.');
    process.exit(1);
}

type HueBrightnessShift = { hueShift: number; brightnessShift: number };

type CharacterAppearance = {
    body: HueBrightnessShift;
    head: HueBrightnessShift;
    accessories: {
        neck: {
            itemId: string;
            equipped: boolean;
            hueShift: number;
            brightnessShift: number;
        };
        cape: {
            itemId: string;
            equipped: boolean;
            hueShift: number;
            brightnessShift: number;
        };
    };
};

const DEFAULT_APPEARANCE: CharacterAppearance = {
    body: { hueShift: 0, brightnessShift: 0 },
    head: { hueShift: 0, brightnessShift: 0 },
    accessories: {
        neck: { itemId: 'scarf', equipped: true, hueShift: 0, brightnessShift: 0 },
        cape: { itemId: 'cape', equipped: true, hueShift: 0, brightnessShift: 0 }
    }
};

const num = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const bool = (value: unknown, fallback: boolean) =>
    typeof value === 'boolean' ? value : fallback;
const str = (value: unknown, fallback: string) =>
    typeof value === 'string' && value.length > 0 ? value : fallback;

const normalizeAppearance = (appearance: any): CharacterAppearance => {
    return {
        body: {
            hueShift: num(appearance?.body?.hueShift, DEFAULT_APPEARANCE.body.hueShift),
            brightnessShift: num(appearance?.body?.brightnessShift, DEFAULT_APPEARANCE.body.brightnessShift)
        },
        head: {
            hueShift: num(appearance?.head?.hueShift, DEFAULT_APPEARANCE.head.hueShift),
            brightnessShift: num(appearance?.head?.brightnessShift, DEFAULT_APPEARANCE.head.brightnessShift)
        },
        accessories: {
            neck: {
                itemId: str(appearance?.accessories?.neck?.itemId, DEFAULT_APPEARANCE.accessories.neck.itemId),
                equipped: bool(
                    appearance?.accessories?.neck?.equipped ?? appearance?.accessories?.scarf?.equipped,
                    DEFAULT_APPEARANCE.accessories.neck.equipped
                ),
                hueShift: num(appearance?.accessories?.neck?.hueShift, DEFAULT_APPEARANCE.accessories.neck.hueShift),
                brightnessShift: num(
                    appearance?.accessories?.neck?.brightnessShift,
                    DEFAULT_APPEARANCE.accessories.neck.brightnessShift
                )
            },
            cape: {
                itemId: str(appearance?.accessories?.cape?.itemId, DEFAULT_APPEARANCE.accessories.cape.itemId),
                equipped: bool(appearance?.accessories?.cape?.equipped, DEFAULT_APPEARANCE.accessories.cape.equipped),
                hueShift: num(appearance?.accessories?.cape?.hueShift, DEFAULT_APPEARANCE.accessories.cape.hueShift),
                brightnessShift: num(
                    appearance?.accessories?.cape?.brightnessShift,
                    DEFAULT_APPEARANCE.accessories.cape.brightnessShift
                )
            }
        }
    };
};

const run = async () => {
    await mongoose.connect(MONGO_URI);

    const users = await User.find({}, { characterAppearance: 1 });
    const updates = users.map((user) => {
        const normalized = normalizeAppearance(user.characterAppearance || DEFAULT_APPEARANCE);
        return {
            updateOne: {
                filter: { _id: user._id },
                update: { $set: { characterAppearance: normalized } }
            }
        };
    });

    if (updates.length > 0) {
        const result = await User.bulkWrite(updates);
        console.log(`[migrate-character-appearance] Updated ${result.modifiedCount} users.`);
    } else {
        console.log('[migrate-character-appearance] No users found.');
    }

    await mongoose.disconnect();
};

run().catch((err) => {
    console.error('[migrate-character-appearance] Failed:', err);
    mongoose.disconnect().finally(() => process.exit(1));
});
