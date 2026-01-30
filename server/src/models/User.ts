import mongoose, { Schema, Document } from 'mongoose';

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
  mutedUntil: { type: Date, default: null }
}, {
  timestamps: true
});

export default mongoose.model<IUser>('User', UserSchema);
