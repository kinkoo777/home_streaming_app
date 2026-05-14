# FilmBox Database Architecture

## Overview

This document describes the database architecture for the FilmBox streaming application.

## Database Structure

```
┌─────────────────────────────────────────────────────────────┐
│                        USERS                                │
│  - id (PK)                                                  │
│  - email                                                    │
│  - password_hash                                            │
│  - subscription_tier                                        │
│  - created_at, updated_at                                   │
└──────────────────┬──────────────────────────────────────────┘
                   │ 1:N
                   │
┌──────────────────▼──────────────────────────────────────────┐
│                      PROFILES                               │
│  - id (PK)                                                  │
│  - user_id (FK)                                             │
│  - name                                                     │
│  - avatar_color / avatar_url                                │
│  - theme (dark/light/auto)                                  │
│  - language                                                 │
│  - is_kids_profile                                          │
│  - pin_code (optional)                                      │
└──────┬──────────────┬──────────────┬──────────────┬─────────┘
       │ 1:N          │ 1:N          │ 1:N          │ 1:1
       │              │              │              │
       ▼              ▼              ▼              ▼
┌─────────────┐ ┌──────────┐ ┌─────────────┐ ┌────────────────┐
│   LISTS     │ │FAVORITES │ │WATCH HISTORY│ │PROFILE_SETTINGS│
│             │ │          │ │             │ │                │
│ - id (PK)   │ │- id (PK) │ │- id (PK)    │ │- id (PK)       │
│ - name      │ │- tmdb_id │ │- tmdb_id    │ │- theme         │
│ - is_default│ │- media   │ │- progress   │ │- accent_color  │
└──────┬──────┘ │  _type   │ │- season/ep  │ │- autoplay_next │
       │ 1:N    │- title   │ │- completed  │ │- default_      │
       │        │- added_at│ │- last_      │ │  quality       │
       ▼        └──────────┘ │  watched_at │ │- notifications │
┌────────────┐               └─────────────┘ └────────────────┘
│LIST_ITEMS  │
│            │
│- id (PK)   │
│- tmdb_id   │
│- media_type│
│- title     │
│- poster    │
│- added_at  │
└────────────┘

       ALSO AVAILABLE:
       ┌──────────────┐  ┌────────────────┐
       │   RATINGS    │  │SEARCH_HISTORY  │
       │              │  │                │
       │ - rating     │  │ - query        │
       │ - review     │  │ - result_count │
       └──────────────┘  └────────────────┘
```

## Entity Descriptions

### Users
- **Purpose**: Main account holder (can have multiple profiles)
- **Key Fields**:
  - `email`: Unique login identifier
  - `password_hash`: Bcrypt hashed password
  - `subscription_tier`: free, basic, premium
  - `subscription_expires_at`: For premium subscriptions

### Profiles
- **Purpose**: Individual user profiles (like Netflix profiles)
- **Key Fields**:
  - `name`: Profile display name (max 50 chars)
  - `avatar_color`: Hex color for profile icon
  - `avatar_url`: Optional custom profile picture
  - `theme`: dark, light, or auto
  - `is_kids_profile`: Restricted content for kids
  - `pin_code`: Optional 4-digit PIN protection

### Lists (Watchlists)
- **Purpose**: Custom collections of movies/series
- **Key Fields**:
  - `name`: List name (e.g., "Watch Later", "Favorites")
  - `is_default`: One default list per profile
  - Each list contains multiple `list_items`

### List Items
- **Purpose**: Individual movies/series in a list
- **Key Fields**:
  - `tmdb_id`: TMDB API movie/series ID
  - `media_type`: 'movie' or 'tv'
  - `title`, `poster_path`: Cached TMDB data
  - `added_at`: When added to list

### Favorites
- **Purpose**: Quick favorites (separate from lists)
- **Difference from Lists**: Faster access, appears in UI separately

### Watch History
- **Purpose**: Track what users watched and progress
- **Key Fields**:
  - `progress_seconds` / `duration_seconds`: Playback position
  - `progress_percentage`: 0-100%
  - `season_number` / `episode_number`: For TV shows
  - `completed`: Finished watching?
  - `last_watched_at`: Continue watching feature

### Profile Settings
- **Purpose**: User preferences
- **Categories**:
  - Theme: dark/light mode, accent color
  - Playback: autoplay, skip intro, quality, subtitles
  - Notifications: email alerts, new releases

### Ratings
- **Purpose**: User ratings and reviews
- **Key Fields**:
  - `rating`: 0-10 scale
  - `review`: Optional text review

### Search History
- **Purpose**: Track searches for autocomplete and recommendations
- **Key Fields**:
  - `query`: Search text
  - `clicked_tmdb_id`: What they clicked on

## Database Choices

### Option 1: SQL (PostgreSQL/MySQL)
**Pros:**
- Strong data integrity
- ACID transactions
- Great for relational data
- Mature ecosystem

**File:** `schema.sql`

**Setup:**
```bash
# PostgreSQL
psql -U postgres -d filmbox < database/schema.sql

# MySQL
mysql -u root -p filmbox < database/schema.sql
```

### Option 2: NoSQL (MongoDB)
**Pros:**
- Flexible schema
- Fast for read-heavy operations
- Embedded documents (less joins)
- Easy to scale horizontally

**File:** `schema.mongodb.js`

**Setup:**
```bash
mongosh filmbox < database/schema.mongodb.js
```

## Migration from localStorage

Current app uses localStorage for:
- `filmbox_lists`: Watchlists
- `filmbox_progress_*`: Watch progress
- User profiles

Migration script: `migrate-localstorage.js` (to be created)

## Security Considerations

1. **Passwords**: Always use bcrypt (min 10 rounds)
2. **Session Management**: Use JWT tokens or express-session
3. **SQL Injection**: Use parameterized queries
4. **Rate Limiting**: Protect login/signup endpoints
5. **HTTPS**: Always use SSL in production
6. **Profile PINs**: Hash PIN codes like passwords

## Performance Optimization

1. **Indexes**: Already defined in schema
2. **Caching**: Use Redis for frequently accessed data
3. **Pagination**: Limit results for lists and history
4. **CDN**: Store profile pictures on CDN
5. **Database Pooling**: Connection pool (10-20 connections)

## API Endpoints (To Be Implemented)

```
Authentication:
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

Profiles:
GET    /api/profiles
POST   /api/profiles
PUT    /api/profiles/:id
DELETE /api/profiles/:id
POST   /api/profiles/:id/verify-pin

Lists:
GET    /api/lists
POST   /api/lists
PUT    /api/lists/:id
DELETE /api/lists/:id
POST   /api/lists/:id/items
DELETE /api/lists/:id/items/:itemId

Favorites:
GET    /api/favorites
POST   /api/favorites
DELETE /api/favorites/:id

Watch History:
GET    /api/watch-history
POST   /api/watch-history
PUT    /api/watch-history/:id

Settings:
GET    /api/settings
PUT    /api/settings

Ratings:
GET    /api/ratings
POST   /api/ratings
PUT    /api/ratings/:id
```

## Next Steps

1. Choose database (SQL or MongoDB)
2. Install dependencies (`npm install pg` or `npm install mongoose`)
3. Create `.env` file with database credentials
4. Implement database models (`database/models/`)
5. Create API routes (`routes/`)
6. Update frontend to use API instead of localStorage
7. Implement authentication (JWT)
8. Add migration script for existing users

## Environment Variables

```env
# Database (choose one)
DATABASE_URL=postgresql://user:password@localhost:5432/filmbox
# OR
MONGODB_URI=mongodb://localhost:27017/filmbox

# Authentication
JWT_SECRET=your-super-secret-jwt-key-change-this
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=10

# Session
SESSION_SECRET=your-session-secret-change-this
```
