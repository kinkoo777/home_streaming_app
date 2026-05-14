const mongoose = require('mongoose');

const watchHistorySchema = new mongoose.Schema({
  profileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    index: true
  },
  tmdbId: {
    type: Number,
    required: true,
    index: true
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

  // For TV shows
  seasonNumber: {
    type: Number,
    default: null
  },
  episodeNumber: {
    type: Number,
    default: null
  },
  episodeTitle: {
    type: String,
    default: null
  },

  // Progress tracking
  progressSeconds: {
    type: Number,
    default: 0,
    min: 0
  },
  durationSeconds: {
    type: Number,
    default: 0,
    min: 0
  },
  progressPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },

  completed: {
    type: Boolean,
    default: false
  },
  lastWatchedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Compound indexes
watchHistorySchema.index({ profileId: 1, lastWatchedAt: -1 });
watchHistorySchema.index({ tmdbId: 1, mediaType: 1 });
watchHistorySchema.index({ profileId: 1, completed: 1 });

// For TV shows, unique constraint per episode
watchHistorySchema.index({
  profileId: 1,
  tmdbId: 1,
  mediaType: 1,
  seasonNumber: 1,
  episodeNumber: 1
}, { unique: true, sparse: true });

// For movies, unique constraint per movie
watchHistorySchema.index({
  profileId: 1,
  tmdbId: 1,
  mediaType: 1
}, { unique: true, partialFilterExpression: { mediaType: 'movie' } });

// Method to update progress
watchHistorySchema.methods.updateProgress = function(progressSeconds, durationSeconds) {
  this.progressSeconds = progressSeconds;
  this.durationSeconds = durationSeconds;

  if (durationSeconds > 0) {
    this.progressPercentage = Math.min(
      100,
      Math.round((progressSeconds / durationSeconds) * 100)
    );
  }

  // Mark as completed if watched > 90%
  this.completed = this.progressPercentage >= 90;

  this.lastWatchedAt = new Date();
};

// Static method to get continue watching items
watchHistorySchema.statics.getContinueWatching = function(profileId, limit = 10) {
  return this.find({
    profileId,
    completed: false,
    progressPercentage: { $gte: 5 } // At least 5% watched
  })
    .sort({ lastWatchedAt: -1 })
    .limit(limit);
};

// Static method to get recently completed
watchHistorySchema.statics.getRecentlyCompleted = function(profileId, limit = 10) {
  return this.find({
    profileId,
    completed: true
  })
    .sort({ lastWatchedAt: -1 })
    .limit(limit);
};

// Virtual for formatted progress
watchHistorySchema.virtual('formattedProgress').get(function() {
  const hours = Math.floor(this.progressSeconds / 3600);
  const minutes = Math.floor((this.progressSeconds % 3600) / 60);
  const seconds = this.progressSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

watchHistorySchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('WatchHistory', watchHistorySchema);
