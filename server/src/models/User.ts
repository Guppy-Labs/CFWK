import mongoose, { Schema, Document } from 'mongoose';
import { ICharacterAppearance, DEFAULT_CHARACTER_APPEARANCE } from '@cfwk/shared';

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
  premiumCurrentPeriodEnd: { type: Date }
}, {
  timestamps: true
});

export default mongoose.model<IUser>('User', UserSchema);
