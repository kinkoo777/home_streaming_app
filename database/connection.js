// =====================================================
// Database Connection Manager
// =====================================================

const mongoose = require('mongoose');
const config = require('./config');

let isConnected = false;

/**
 * Connect to MongoDB database
 * @returns {Promise<void>}
 */
async function connectDB() {
  if (isConnected) {
    console.log('✓ Using existing database connection');
    return;
  }

  try {
    const db = await mongoose.connect(config.mongodb.uri, config.mongodb.options);

    isConnected = db.connections[0].readyState === 1;

    console.log('✓ MongoDB connected successfully');
    console.log(`  Database: ${db.connection.name}`);
    console.log(`  Host: ${db.connection.host}`);

    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('✗ MongoDB connection error:', err);
      isConnected = false;
    });

    mongoose.connection.on('disconnected', () => {
      console.log('⚠ MongoDB disconnected');
      isConnected = false;
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('✓ MongoDB connection closed (app termination)');
      process.exit(0);
    });

  } catch (error) {
    console.error('✗ MongoDB connection failed:', error.message);
    throw error;
  }
}

/**
 * Disconnect from database
 * @returns {Promise<void>}
 */
async function disconnectDB() {
  if (!isConnected) {
    return;
  }

  try {
    await mongoose.connection.close();
    isConnected = false;
    console.log('✓ MongoDB disconnected');
  } catch (error) {
    console.error('✗ Error disconnecting from MongoDB:', error.message);
    throw error;
  }
}

/**
 * Get connection status
 * @returns {boolean}
 */
function isDBConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}

module.exports = {
  connectDB,
  disconnectDB,
  isDBConnected
};
