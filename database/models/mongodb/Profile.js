const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const profileSettingsSchema = new mongoose.Schema({
  accentColor: {
    type: String,
    default: '#3b82f6',
    match: /^#[0-9A-Fa-f]{6}$/
  },
  autoplayNext: {
    type: Boolean,
    default: true
  },
  autoSkipIntro: {
    type: Boolean,
    default: false
  },
  defaultQuality: {
    type: String,
    enum: ['auto', '1080p', '720p', '480p', '360p'],
    default: 'auto'
  },
  defaultSubtitles: {
    type: String,
    default: null // 'cs', 'en', 'off', null
  },
  emailNotifications: {
    type: Boolean,
    default: true
  },
  newReleasesNotify: {
    type: Boolean,
    default: true
  },
  watchlistUpdates: {
    type: Boolean,
    default: true
  }
}, { _id: false });

const profileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    maxlength: 50,
    trim: true
  },
  avatarColor: {
    type: String,
    default: '#3b82f6',
    match: /^#[0-9A-Fa-f]{6}$/
  },
  avatarUrl: {
    type: String,
    default: null
  },
  theme: {
    type: String,
    enum: ['dark', 'light', 'auto'],
    default: 'dark'
  },
  language: {
    type: String,
    default: 'cs'
  },
  isKidsProfile: {
    type: Boolean,
    default: false
  },
  pinCode: {
    type: String,
    default: null,
    match: /^\d{4}$/
  },
  settings: {
    type: profileSettingsSchema,
    default: () => ({})
  }
}, {
  timestamps: true
});

// Compound index for unique profile names per user
profileSchema.index({ userId: 1, name: 1 }, { unique: true });

// Hash PIN code before saving
profileSchema.pre('save', async function(next) {
  if (!this.isModified('pinCode') || !this.pinCode) return next();

  try {
    const salt = await bcrypt.genSalt(5); // Lighter hashing for PINs
    this.pinCode = await bcrypt.hash(this.pinCode, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to verify PIN
profileSchema.methods.verifyPin = async function(candidatePin) {
  if (!this.pinCode) return true; // No PIN set
  return bcrypt.compare(candidatePin, this.pinCode);
};

// Virtual for profile initials (for avatar)
profileSchema.virtual('initials').get(function() {
  return this.name
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
});

// Ensure virtuals are included in JSON
profileSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Profile', profileSchema);
