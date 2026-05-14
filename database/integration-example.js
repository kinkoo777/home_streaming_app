// =====================================================
// Example: How to integrate database into server.js
// =====================================================

const express = require('express');
const { connectDB } = require('./database/connection');
const { User, Profile, List, WatchHistory, Favorite } = require('./database/models');

const app = express();
app.use(express.json());

// Connect to database on startup
connectDB().catch(err => {
  console.error('Failed to connect to database:', err);
  process.exit(1);
});

// =====================================================
// EXAMPLE API ENDPOINTS
// =====================================================

// ─── PROFILES ───────────────────────────────────────

// Get all profiles for a user
app.get('/api/profiles', async (req, res) => {
  try {
    // In production, get userId from JWT token
    const userId = req.query.userId; // Temporary

    const profiles = await Profile.find({ userId })
      .sort({ createdAt: 1 })
      .select('-pinCode'); // Don't send PIN code

    res.json(profiles);
  } catch (error) {
    console.error('Error fetching profiles:', error);
    res.status(500).json({ error: 'Failed to fetch profiles' });
  }
});

// Create new profile
app.post('/api/profiles', async (req, res) => {
  try {
    const { userId, name, avatarColor, theme, pinCode } = req.body;

    const profile = await Profile.create({
      userId,
      name,
      avatarColor: avatarColor || '#3b82f6',
      theme: theme || 'dark',
      pinCode: pinCode || null
    });

    // Create default list for this profile
    await List.create({
      profileId: profile._id,
      name: 'Můj seznam',
      isDefault: true,
      items: []
    });

    res.status(201).json(profile);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Profil s tímto názvem již existuje' });
    }
    console.error('Error creating profile:', error);
    res.status(500).json({ error: 'Failed to create profile' });
  }
});

// Update profile
app.put('/api/profiles/:id', async (req, res) => {
  try {
    const { name, avatarColor, theme, avatarUrl } = req.body;

    const profile = await Profile.findByIdAndUpdate(
      req.params.id,
      { name, avatarColor, theme, avatarUrl },
      { new: true, runValidators: true }
    );

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json(profile);
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ─── LISTS ──────────────────────────────────────────

// Get all lists for a profile
app.get('/api/lists', async (req, res) => {
  try {
    const { profileId } = req.query;

    const lists = await List.find({ profileId })
      .sort({ isDefault: -1, createdAt: 1 });

    res.json(lists);
  } catch (error) {
    console.error('Error fetching lists:', error);
    res.status(500).json({ error: 'Failed to fetch lists' });
  }
});

// Create new list
app.post('/api/lists', async (req, res) => {
  try {
    const { profileId, name, description } = req.body;

    const list = await List.create({
      profileId,
      name,
      description: description || null,
      isDefault: false,
      items: []
    });

    res.status(201).json(list);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Seznam s tímto názvem již existuje' });
    }
    console.error('Error creating list:', error);
    res.status(500).json({ error: 'Failed to create list' });
  }
});

// Add item to list
app.post('/api/lists/:listId/items', async (req, res) => {
  try {
    const { listId } = req.params;
    const item = req.body; // { tmdbId, mediaType, title, posterPath, ... }

    const list = await List.findById(listId);
    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    const added = list.addItem(item);
    if (!added) {
      return res.status(400).json({ error: 'Položka již v seznamu existuje' });
    }

    await list.save();
    res.json(list);
  } catch (error) {
    console.error('Error adding item to list:', error);
    res.status(500).json({ error: 'Failed to add item' });
  }
});

// Remove item from list
app.delete('/api/lists/:listId/items/:tmdbId/:mediaType', async (req, res) => {
  try {
    const { listId, tmdbId, mediaType } = req.params;

    const list = await List.findById(listId);
    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    const removed = list.removeItem(parseInt(tmdbId), mediaType);
    if (!removed) {
      return res.status(404).json({ error: 'Item not found in list' });
    }

    await list.save();
    res.json(list);
  } catch (error) {
    console.error('Error removing item from list:', error);
    res.status(500).json({ error: 'Failed to remove item' });
  }
});

// ─── WATCH HISTORY ──────────────────────────────────

// Get continue watching
app.get('/api/watch-history/continue', async (req, res) => {
  try {
    const { profileId } = req.query;

    const continueWatching = await WatchHistory.getContinueWatching(profileId, 10);

    res.json(continueWatching);
  } catch (error) {
    console.error('Error fetching continue watching:', error);
    res.status(500).json({ error: 'Failed to fetch watch history' });
  }
});

// Update watch progress
app.post('/api/watch-history', async (req, res) => {
  try {
    const {
      profileId,
      tmdbId,
      mediaType,
      title,
      posterPath,
      seasonNumber,
      episodeNumber,
      episodeTitle,
      progressSeconds,
      durationSeconds
    } = req.body;

    // Find or create watch history entry
    let history = await WatchHistory.findOne({
      profileId,
      tmdbId,
      mediaType,
      seasonNumber: seasonNumber || null,
      episodeNumber: episodeNumber || null
    });

    if (!history) {
      history = new WatchHistory({
        profileId,
        tmdbId,
        mediaType,
        title,
        posterPath,
        seasonNumber,
        episodeNumber,
        episodeTitle
      });
    }

    history.updateProgress(progressSeconds, durationSeconds);
    await history.save();

    res.json(history);
  } catch (error) {
    console.error('Error updating watch history:', error);
    res.status(500).json({ error: 'Failed to update watch history' });
  }
});

// ─── FAVORITES ──────────────────────────────────────

// Get favorites
app.get('/api/favorites', async (req, res) => {
  try {
    const { profileId } = req.query;

    const favorites = await Favorite.find({ profileId })
      .sort({ addedAt: -1 });

    res.json(favorites);
  } catch (error) {
    console.error('Error fetching favorites:', error);
    res.status(500).json({ error: 'Failed to fetch favorites' });
  }
});

// Add to favorites
app.post('/api/favorites', async (req, res) => {
  try {
    const { profileId, tmdbId, mediaType, title, posterPath } = req.body;

    const favorite = await Favorite.create({
      profileId,
      tmdbId,
      mediaType,
      title,
      posterPath
    });

    res.status(201).json(favorite);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Already in favorites' });
    }
    console.error('Error adding to favorites:', error);
    res.status(500).json({ error: 'Failed to add to favorites' });
  }
});

// Remove from favorites
app.delete('/api/favorites/:profileId/:tmdbId/:mediaType', async (req, res) => {
  try {
    const { profileId, tmdbId, mediaType } = req.params;

    const result = await Favorite.deleteOne({
      profileId,
      tmdbId: parseInt(tmdbId),
      mediaType
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Favorite not found' });
    }

    res.json({ message: 'Removed from favorites' });
  } catch (error) {
    console.error('Error removing from favorites:', error);
    res.status(500).json({ error: 'Failed to remove from favorites' });
  }
});

// ─── PROFILE SETTINGS ───────────────────────────────

// Get profile settings
app.get('/api/profiles/:id/settings', async (req, res) => {
  try {
    const profile = await Profile.findById(req.params.id).select('settings');

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json(profile.settings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update profile settings
app.put('/api/profiles/:id/settings', async (req, res) => {
  try {
    const updates = req.body;

    const profile = await Profile.findByIdAndUpdate(
      req.params.id,
      { $set: { 'settings': { ...updates } } },
      { new: true, runValidators: true }
    );

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json(profile.settings);
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// =====================================================
// START SERVER
// =====================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
});

module.exports = app;
