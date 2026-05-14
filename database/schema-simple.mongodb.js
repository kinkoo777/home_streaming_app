// =====================================================
// FilmBox Home Streaming App - Simplified MongoDB Schema
// No authentication, subscriptions, or passwords
// =====================================================

// Drop existing collections if they exist
db.profiles.drop();
db.lists.drop();
db.watchHistory.drop();
db.favorites.drop();
db.searchHistory.drop();

print("Creating collections...");

// =====================================================
// PROFILES Collection (No user accounts, just profiles)
// =====================================================

db.createCollection("profiles", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["name", "createdAt"],
      properties: {
        _id: { bsonType: "objectId" },
        name: {
          bsonType: "string",
          maxLength: 50
        },
        avatarColor: {
          bsonType: "string",
          pattern: "^#[0-9A-Fa-f]{6}$"
        },
        theme: {
          enum: ["dark", "light", "auto"],
          bsonType: "string"
        },
        language: { bsonType: "string" },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
        settings: {
          bsonType: "object",
          properties: {
            accentColor: { bsonType: "string" },
            autoplayNext: { bsonType: "bool" },
            autoSkipIntro: { bsonType: "bool" },
            defaultQuality: { bsonType: "string" },
            defaultSubtitles: { bsonType: ["string", "null"] }
          }
        }
      }
    }
  }
});

// =====================================================
// LISTS Collection (Watchlists)
// =====================================================

db.createCollection("lists", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["profileId", "name", "items"],
      properties: {
        _id: { bsonType: "objectId" },
        profileId: { bsonType: "objectId" },
        name: { bsonType: "string" },
        description: { bsonType: ["string", "null"] },
        isDefault: { bsonType: "bool" },
        items: {
          bsonType: "array",
          items: {
            bsonType: "object",
            required: ["tmdbId", "mediaType", "title", "addedAt"],
            properties: {
              tmdbId: { bsonType: "int" },
              mediaType: { enum: ["movie", "tv"], bsonType: "string" },
              title: { bsonType: "string" },
              posterPath: { bsonType: ["string", "null"] },
              releaseDate: { bsonType: ["string", "null"] },
              voteAverage: { bsonType: ["double", "null"] },
              addedAt: { bsonType: "date" }
            }
          }
        },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" }
      }
    }
  }
});

// =====================================================
// WATCH HISTORY Collection
// =====================================================

db.createCollection("watchHistory", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["profileId", "tmdbId", "mediaType", "title", "lastWatchedAt"],
      properties: {
        _id: { bsonType: "objectId" },
        profileId: { bsonType: "objectId" },
        tmdbId: { bsonType: "int" },
        mediaType: { enum: ["movie", "tv"], bsonType: "string" },
        title: { bsonType: "string" },
        posterPath: { bsonType: ["string", "null"] },
        seasonNumber: { bsonType: ["int", "null"] },
        episodeNumber: { bsonType: ["int", "null"] },
        episodeTitle: { bsonType: ["string", "null"] },
        progressSeconds: { bsonType: "int" },
        durationSeconds: { bsonType: "int" },
        progressPercentage: { bsonType: "double" },
        completed: { bsonType: "bool" },
        lastWatchedAt: { bsonType: "date" },
        createdAt: { bsonType: "date" }
      }
    }
  }
});

// =====================================================
// FAVORITES Collection
// =====================================================

db.createCollection("favorites", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["profileId", "tmdbId", "mediaType", "title", "addedAt"],
      properties: {
        _id: { bsonType: "objectId" },
        profileId: { bsonType: "objectId" },
        tmdbId: { bsonType: "int" },
        mediaType: { enum: ["movie", "tv"], bsonType: "string" },
        title: { bsonType: "string" },
        posterPath: { bsonType: ["string", "null"] },
        addedAt: { bsonType: "date" }
      }
    }
  }
});

// =====================================================
// SEARCH HISTORY Collection
// =====================================================

db.createCollection("searchHistory", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["profileId", "query", "searchedAt"],
      properties: {
        _id: { bsonType: "objectId" },
        profileId: { bsonType: "objectId" },
        query: { bsonType: "string" },
        resultCount: { bsonType: "int" },
        clickedTmdbId: { bsonType: ["int", "null"] },
        clickedMediaType: { bsonType: ["string", "null"] },
        searchedAt: { bsonType: "date" }
      }
    }
  }
});

print("✓ Collections created successfully!");

// =====================================================
// Create Indexes
// =====================================================

print("Creating indexes...");

// Profiles
db.profiles.createIndex({ name: 1 }, { unique: true });

// Lists
db.lists.createIndex({ profileId: 1 });
db.lists.createIndex({ profileId: 1, isDefault: 1 });
db.lists.createIndex({ "items.tmdbId": 1, "items.mediaType": 1 });

// Watch History
db.watchHistory.createIndex({ profileId: 1, lastWatchedAt: -1 });
db.watchHistory.createIndex({ tmdbId: 1, mediaType: 1 });
db.watchHistory.createIndex({ profileId: 1, completed: 1 });

// Favorites
db.favorites.createIndex({ profileId: 1, addedAt: -1 });
db.favorites.createIndex({ profileId: 1, tmdbId: 1, mediaType: 1 }, { unique: true });

// Search History
db.searchHistory.createIndex({ profileId: 1, searchedAt: -1 });

print("✓ Indexes created successfully!");

// =====================================================
// Insert Sample Data
// =====================================================

print("Creating sample profiles...");

// Sample profiles
const profile1 = db.profiles.insertOne({
  name: "Demo User",
  avatarColor: "#3b82f6",
  theme: "dark",
  language: "cs",
  createdAt: new Date(),
  updatedAt: new Date(),
  settings: {
    accentColor: "#3b82f6",
    autoplayNext: true,
    autoSkipIntro: false,
    defaultQuality: "auto",
    defaultSubtitles: null
  }
});

const profile2 = db.profiles.insertOne({
  name: "Kids",
  avatarColor: "#f59e0b",
  theme: "light",
  language: "cs",
  createdAt: new Date(),
  updatedAt: new Date(),
  settings: {
    accentColor: "#f59e0b",
    autoplayNext: true,
    autoSkipIntro: true,
    defaultQuality: "720p",
    defaultSubtitles: null
  }
});

print("✓ Sample profiles created!");
print("  - Demo User (ID: " + profile1.insertedId + ")");
print("  - Kids (ID: " + profile2.insertedId + ")");

// Create default lists for each profile
print("Creating default lists...");

db.lists.insertOne({
  profileId: profile1.insertedId,
  name: "Můj seznam",
  description: "Výchozí seznam oblíbených",
  isDefault: true,
  items: [],
  createdAt: new Date(),
  updatedAt: new Date()
});

db.lists.insertOne({
  profileId: profile2.insertedId,
  name: "Můj seznam",
  description: "Výchozí seznam oblíbených",
  isDefault: true,
  items: [],
  createdAt: new Date(),
  updatedAt: new Date()
});

print("✓ Default lists created!");

// =====================================================
// Summary
// =====================================================

print("\n=====================================");
print("✓ Database setup complete!");
print("=====================================");
print("Database: filmbox");
print("Collections created: 5");
print("  - profiles");
print("  - lists");
print("  - watchHistory");
print("  - favorites");
print("  - searchHistory");
print("");
print("Sample profiles: 2");
print("  - Demo User");
print("  - Kids");
print("=====================================");
