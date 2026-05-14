const mongoose = require('mongoose');

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
    default: null
  }
}, { _id: false });

const profileSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    maxlength: 50,
    trim: true
  },
  avatarColor: {
    type: String,
    default: '#3b82f6',
    match: /^#[0-9A-Fa-f]{6}$/
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
  settings: {
    type: profileSettingsSchema,
    default: () => ({})
  }
}, {
  timestamps: true
});

// Virtual for profile initials (for avatar)
profileSchema.virtual('initials').get(function() {
  return this.name
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
});

profileSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Profile', profileSchema);
