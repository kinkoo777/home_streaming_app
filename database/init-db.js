// =====================================================
// Initialize FilmBox Database
// =====================================================

require('dotenv').config();
const mongoose = require('mongoose');
const { Profile, List } = require('./models');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/filmbox';

async function initDatabase() {
  console.log('🚀 Initializing FilmBox database...\n');

  try {
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✓ Connected to MongoDB\n');

    // Clear existing data (optional - comment out if you want to keep existing data)
    console.log('🗑️  Clearing existing collections...');
    await Profile.deleteMany({});
    await List.deleteMany({});
    console.log('✓ Collections cleared\n');

    // Create sample profiles
    console.log('👤 Creating sample profiles...');

    const profile1 = await Profile.create({
      name: 'Demo User',
      avatarColor: '#3b82f6',
      theme: 'dark',
      language: 'cs',
      settings: {
        accentColor: '#3b82f6',
        autoplayNext: true,
        autoSkipIntro: false,
        defaultQuality: 'auto',
        defaultSubtitles: null
      }
    });
    console.log(`  ✓ Created profile: ${profile1.name} (${profile1._id})`);

    const profile2 = await Profile.create({
      name: 'Kids',
      avatarColor: '#f59e0b',
      theme: 'light',
      language: 'cs',
      settings: {
        accentColor: '#f59e0b',
        autoplayNext: true,
        autoSkipIntro: true,
        defaultQuality: '720p',
        defaultSubtitles: null
      }
    });
    console.log(`  ✓ Created profile: ${profile2.name} (${profile2._id})\n`);

    // Create default lists
    console.log('📋 Creating default lists...');

    const list1 = await List.create({
      profileId: profile1._id,
      name: 'Můj seznam',
      description: 'Výchozí seznam oblíbených',
      isDefault: true,
      items: []
    });
    console.log(`  ✓ Created list for ${profile1.name}`);

    const list2 = await List.create({
      profileId: profile2._id,
      name: 'Můj seznam',
      description: 'Výchozí seznam oblíbených',
      isDefault: true,
      items: []
    });
    console.log(`  ✓ Created list for ${profile2.name}\n`);

    // Summary
    console.log('═══════════════════════════════════════');
    console.log('✅ Database initialized successfully!');
    console.log('═══════════════════════════════════════');
    console.log(`Database: ${mongoose.connection.name}`);
    console.log(`Host: ${mongoose.connection.host}`);
    console.log('');
    console.log('Collections:');
    console.log('  • profiles (2 documents)');
    console.log('  • lists (2 documents)');
    console.log('  • watchHistory (empty)');
    console.log('  • favorites (empty)');
    console.log('  • searchHistory (empty)');
    console.log('');
    console.log('Sample Profiles:');
    console.log(`  • ${profile1.name} - ${profile1.theme} theme`);
    console.log(`  • ${profile2.name} - ${profile2.theme} theme`);
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Error initializing database:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('✓ Database connection closed');
    process.exit(0);
  }
}

// Run initialization
initDatabase();
