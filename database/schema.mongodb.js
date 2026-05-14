// =====================================================
// FilmBox Streaming App - MongoDB Schema
// =====================================================

// Users Collection
db.createCollection("users", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["email", "passwordHash", "createdAt"],
      properties: {
        _id: { bsonType: "objectId" },
        email: {
          bsonType: "string",
          pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"
        },
        passwordHash: { bsonType: "string" },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
        lastLogin: { bsonType: ["date", "null"] },
        isActive: { bsonType: "bool" },
        subscriptionTier: {
          enum: ["free", "basic", "premium"],
          bsonType: "string"
        },
        subscriptionExpiresAt: { bsonType: ["date", "null"] }
      }
    }
  }
});

// Profiles Collection
db.createCollection("profiles", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["userId", "name", "createdAt"],
      properties: {
        _id: { bsonType: "objectId" },
        userId: { bsonType: "objectId" },
        name: {
          bsonType: "string",
          maxLength: 50
        },
        avatarColor: {
          bsonType: "string",
          pattern: "^#[0-9A-Fa-f]{6}$"
        },
        avatarUrl: { bsonType: ["string", "null"] },
        theme: {
          enum: ["dark", "light", "auto"],
          bsonType: "string"
        },
        language: { bsonType: "string" },
        isKidsProfile: { bsonType: "bool" },
        pinCode: { bsonType: ["string", "null"] },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
        settings: {
          bsonType: "object",
          properties: {
            accentColor: { bsonType: "string" },
            autoplayNext: { bsonType: "bool" },
            autoSkipIntro: { bsonType: "bool" },
            defaultQuality: { bsonType: "string" },
            defaultSubtitles: { bsonType: ["string", "null"] },
            emailNotifications: { bsonType: "bool" },
            newReleasesNotify: { bsonType: "bool" },
            watchlistUpdates: { bsonType: "bool" }
          }
        }
      }
    }
  }
});

// Lists Collection (Watchlists)
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

// Watch History Collection
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

// Favorites Collection
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

// Ratings Collection
db.createCollection("ratings", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["profileId", "tmdbId", "mediaType", "rating", "createdAt"],
      properties: {
        _id: { bsonType: "objectId" },
        profileId: { bsonType: "objectId" },
        tmdbId: { bsonType: "int" },
        mediaType: { enum: ["movie", "tv"], bsonType: "string" },
        rating: {
          bsonType: "double",
          minimum: 0,
          maximum: 10
        },
        review: { bsonType: ["string", "null"] },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" }
      }
    }
  }
});

// Search History Collection
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

// =====================================================
// Indexes
// =====================================================

// Users
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ subscriptionExpiresAt: 1 });

// Profiles
db.profiles.createIndex({ userId: 1 });
db.profiles.createIndex({ userId: 1, name: 1 }, { unique: true });

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

// Ratings
db.ratings.createIndex({ profileId: 1, tmdbId: 1, mediaType: 1 }, { unique: true });
db.ratings.createIndex({ profileId: 1, rating: -1 });

// Search History
db.searchHistory.createIndex({ profileId: 1, searchedAt: -1 });
db.searchHistory.createIndex({ query: "text" });

// =====================================================
// Sample Data
// =====================================================

// Sample user
db.users.insertOne({
  email: "demo@filmbox.cz",
  passwordHash: "$2b$10$rBV2lXZ0WZxZ9fZKxGx5Qe5JHQYxGvYXQYZkZQYxGvYXQYZkZQYxG",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastLogin: null,
  isActive: true,
  subscriptionTier: "premium",
  subscriptionExpiresAt: null
});

// Sample profile
const userId = db.users.findOne({ email: "demo@filmbox.cz" })._id;

db.profiles.insertOne({
  userId: userId,
  name: "Demo User",
  avatarColor: "#3b82f6",
  avatarUrl: null,
  theme: "dark",
  language: "cs",
  isKidsProfile: false,
  pinCode: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  settings: {
    accentColor: "#3b82f6",
    autoplayNext: true,
    autoSkipIntro: false,
    defaultQuality: "auto",
    defaultSubtitles: null,
    emailNotifications: true,
    newReleasesNotify: true,
    watchlistUpdates: true
  }
});

// Sample default list
const profileId = db.profiles.findOne({ userId: userId })._id;

db.lists.insertOne({
  profileId: profileId,
  name: "Můj seznam",
  description: "Výchozí seznam oblíbených",
  isDefault: true,
  items: [],
  createdAt: new Date(),
  updatedAt: new Date()
});

print("✓ Database schema and sample data created successfully!");
