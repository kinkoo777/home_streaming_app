// =====================================================
// Database Configuration
// =====================================================

require('dotenv').config();

const config = {
  // Database type: 'mongodb' or 'postgres' or 'mysql'
  dbType: process.env.DB_TYPE || 'mongodb',

  // MongoDB Configuration
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/filmbox',
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    }
  },

  // PostgreSQL Configuration
  postgres: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'filmbox',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    dialect: 'postgres',
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  },

  // MySQL Configuration
  mysql: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    database: process.env.DB_NAME || 'filmbox',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    dialect: 'mysql',
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  },

  // JWT Configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-CHANGE-THIS',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },

  // Bcrypt Configuration
  bcrypt: {
    rounds: parseInt(process.env.BCRYPT_ROUNDS) || 10
  },

  // Session Configuration
  session: {
    secret: process.env.SESSION_SECRET || 'your-session-secret-CHANGE-THIS',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }
  }
};

module.exports = config;
