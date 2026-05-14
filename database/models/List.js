const mongoose = require('mongoose');

const listItemSchema = new mongoose.Schema({
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
  releaseDate: {
    type: String,
    default: null
  },
  voteAverage: {
    type: Number,
    default: null
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const listSchema = new mongoose.Schema({
  profileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    maxlength: 100,
    trim: true
  },
  description: {
    type: String,
    default: null,
    maxlength: 500
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  items: {
    type: [listItemSchema],
    default: []
  }
}, {
  timestamps: true
});

// Compound index for unique list names per profile
listSchema.index({ profileId: 1, name: 1 }, { unique: true });
listSchema.index({ profileId: 1, isDefault: 1 });
listSchema.index({ 'items.tmdbId': 1, 'items.mediaType': 1 });

// Method to add item to list
listSchema.methods.addItem = function(item) {
  const exists = this.items.some(i =>
    i.tmdbId === item.tmdbId && i.mediaType === item.mediaType
  );

  if (exists) return false;

  this.items.unshift({
    tmdbId: item.tmdbId,
    mediaType: item.mediaType,
    title: item.title,
    posterPath: item.posterPath || null,
    releaseDate: item.releaseDate || null,
    voteAverage: item.voteAverage || null,
    addedAt: new Date()
  });

  return true;
};

// Method to remove item from list
listSchema.methods.removeItem = function(tmdbId, mediaType) {
  const initialLength = this.items.length;
  this.items = this.items.filter(i =>
    !(i.tmdbId === tmdbId && i.mediaType === mediaType)
  );
  return this.items.length < initialLength;
};

// Method to check if item is in list
listSchema.methods.hasItem = function(tmdbId, mediaType) {
  return this.items.some(i =>
    i.tmdbId === tmdbId && i.mediaType === mediaType
  );
};

// Virtual for item count
listSchema.virtual('itemCount').get(function() {
  return this.items.length;
});

listSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('List', listSchema);
