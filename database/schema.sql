-- =====================================================
-- FilmBox Streaming App - Database Schema (PostgreSQL/MySQL)
-- =====================================================

-- Users table (main account holder)
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login TIMESTAMP NULL,
    is_active BOOLEAN DEFAULT TRUE,
    subscription_tier VARCHAR(50) DEFAULT 'free', -- free, basic, premium
    subscription_expires_at TIMESTAMP NULL
);

-- Profiles table (multiple profiles per user)
CREATE TABLE profiles (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    name VARCHAR(50) NOT NULL,
    avatar_color VARCHAR(7) DEFAULT '#3b82f6', -- hex color code
    avatar_url VARCHAR(500) NULL, -- optional custom profile picture
    theme VARCHAR(20) DEFAULT 'dark', -- dark, light, auto
    language VARCHAR(10) DEFAULT 'cs', -- cs, en, etc.
    is_kids_profile BOOLEAN DEFAULT FALSE,
    pin_code VARCHAR(4) NULL, -- optional 4-digit PIN for profile lock
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_profile_name (user_id, name)
);

-- Watchlists/Lists table (custom lists per profile)
CREATE TABLE lists (
    id VARCHAR(36) PRIMARY KEY,
    profile_id VARCHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT NULL,
    is_default BOOLEAN DEFAULT FALSE, -- one default list per profile
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
    UNIQUE KEY unique_list_name (profile_id, name)
);

-- List items (movies/series in lists)
CREATE TABLE list_items (
    id VARCHAR(36) PRIMARY KEY,
    list_id VARCHAR(36) NOT NULL,
    tmdb_id INT NOT NULL, -- TMDB movie/series ID
    media_type VARCHAR(20) NOT NULL, -- 'movie' or 'tv'
    title VARCHAR(500) NOT NULL,
    poster_path VARCHAR(500) NULL,
    release_date DATE NULL,
    vote_average DECIMAL(3,1) NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
    UNIQUE KEY unique_list_item (list_id, tmdb_id, media_type)
);

-- Watch history and progress
CREATE TABLE watch_history (
    id VARCHAR(36) PRIMARY KEY,
    profile_id VARCHAR(36) NOT NULL,
    tmdb_id INT NOT NULL,
    media_type VARCHAR(20) NOT NULL, -- 'movie' or 'tv'
    title VARCHAR(500) NOT NULL,
    poster_path VARCHAR(500) NULL,

    -- For TV shows
    season_number INT NULL,
    episode_number INT NULL,
    episode_title VARCHAR(500) NULL,

    -- Progress tracking
    progress_seconds INT DEFAULT 0,
    duration_seconds INT DEFAULT 0,
    progress_percentage DECIMAL(5,2) DEFAULT 0.00, -- 0.00 to 100.00

    completed BOOLEAN DEFAULT FALSE,
    last_watched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
    INDEX idx_profile_watched (profile_id, last_watched_at DESC),
    INDEX idx_media (tmdb_id, media_type)
);

-- User preferences and settings
CREATE TABLE profile_settings (
    id VARCHAR(36) PRIMARY KEY,
    profile_id VARCHAR(36) UNIQUE NOT NULL,

    -- Theme settings
    theme VARCHAR(20) DEFAULT 'dark',
    accent_color VARCHAR(7) DEFAULT '#3b82f6',

    -- Playback settings
    autoplay_next BOOLEAN DEFAULT TRUE,
    auto_skip_intro BOOLEAN DEFAULT FALSE,
    default_quality VARCHAR(10) DEFAULT 'auto', -- auto, 1080p, 720p, 480p
    default_subtitles VARCHAR(10) NULL, -- cs, en, off

    -- Notification settings
    email_notifications BOOLEAN DEFAULT TRUE,
    new_releases_notify BOOLEAN DEFAULT TRUE,
    watchlist_updates BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Favorites (quick access, separate from lists)
CREATE TABLE favorites (
    id VARCHAR(36) PRIMARY KEY,
    profile_id VARCHAR(36) NOT NULL,
    tmdb_id INT NOT NULL,
    media_type VARCHAR(20) NOT NULL,
    title VARCHAR(500) NOT NULL,
    poster_path VARCHAR(500) NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
    UNIQUE KEY unique_favorite (profile_id, tmdb_id, media_type),
    INDEX idx_profile_favorites (profile_id, added_at DESC)
);

-- Ratings (user ratings for movies/series)
CREATE TABLE ratings (
    id VARCHAR(36) PRIMARY KEY,
    profile_id VARCHAR(36) NOT NULL,
    tmdb_id INT NOT NULL,
    media_type VARCHAR(20) NOT NULL,
    rating DECIMAL(2,1) NOT NULL CHECK (rating >= 0 AND rating <= 10),
    review TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
    UNIQUE KEY unique_rating (profile_id, tmdb_id, media_type)
);

-- Search history (for autocomplete and recommendations)
CREATE TABLE search_history (
    id VARCHAR(36) PRIMARY KEY,
    profile_id VARCHAR(36) NOT NULL,
    query VARCHAR(500) NOT NULL,
    result_count INT DEFAULT 0,
    clicked_tmdb_id INT NULL,
    clicked_media_type VARCHAR(20) NULL,
    searched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
    INDEX idx_profile_searches (profile_id, searched_at DESC)
);

-- =====================================================
-- Indexes for performance
-- =====================================================

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_profiles_user ON profiles(user_id);
CREATE INDEX idx_lists_profile ON lists(profile_id);
CREATE INDEX idx_watch_history_profile ON watch_history(profile_id);
CREATE INDEX idx_watch_history_media ON watch_history(tmdb_id, media_type);

-- =====================================================
-- Initial data / seed
-- =====================================================

-- Default user and profile (for development)
-- Password: 'filmbox123' (you should use bcrypt in production)
INSERT INTO users (id, email, password_hash, subscription_tier)
VALUES (
    'user-1',
    'demo@filmbox.cz',
    '$2b$10$rBV2lXZ0WZxZ9fZKxGx5Qe5JHQYxGvYXQYZkZQYxGvYXQYZkZQYxG',
    'premium'
);

-- Default profile
INSERT INTO profiles (id, user_id, name, avatar_color, theme)
VALUES (
    'profile-1',
    'user-1',
    'Demo User',
    '#3b82f6',
    'dark'
);

-- Default list
INSERT INTO lists (id, profile_id, name, is_default)
VALUES (
    'list-1',
    'profile-1',
    'Můj seznam',
    TRUE
);

-- Default settings
INSERT INTO profile_settings (id, profile_id)
VALUES (
    'settings-1',
    'profile-1'
);
