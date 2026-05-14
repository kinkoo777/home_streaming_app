const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema({
  profileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    index: true
  },
  tmdbId: {
    type: Number,
    required: true
  },
  mediaType: {
    type: String,
    enum: ['movie', 'tv'],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  posterPath: {
    type: String,
    default: null
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false
});

// Compound indexes
favoriteSchema.index({ profileId: 1, addedAt: -1 });
favoriteSchema.index({ profileId: 1, tmdbId: 1, mediaType: 1 }, { unique: true });

module.exports = mongoose.model('Favorite', favoriteSchema);
