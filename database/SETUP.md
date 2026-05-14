# Database Setup Guide

## Prerequisites

Choose one database system:
- **MongoDB** (Recommended for quick setup)
- **PostgreSQL** (For more complex queries and ACID compliance)
- **MySQL** (Alternative SQL option)

## Option 1: MongoDB Setup (Recommended)

### Install MongoDB

**Windows:**
```bash
# Download from: https://www.mongodb.com/try/download/community
# Or use Chocolatey:
choco install mongodb

# Start MongoDB service
net start MongoDB
```

**Mac:**
```bash
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community
```

**Linux:**
```bash
# Ubuntu/Debian
sudo apt-get install -y mongodb-org
sudo systemctl start mongod
```

### Setup Database

```bash
# Connect to MongoDB
mongosh

# Create database and user
use filmbox
db.createUser({
  user: "filmbox_admin",
  pwd: "secure_password_here",
  roles: [{ role: "readWrite", db: "filmbox" }]
})

# Exit
exit

# Run schema setup
mongosh filmbox < database/schema.mongodb.js
```

### Install Dependencies

```bash
npm install mongoose bcryptjs jsonwebtoken dotenv
```

### Configure Environment

```bash
# Copy example env file
cp .env.example .env

# Edit .env and set:
DB_TYPE=mongodb
MONGODB_URI=mongodb://localhost:27017/filmbox
# Or with authentication:
# MONGODB_URI=mongodb://filmbox_admin:secure_password_here@localhost:27017/filmbox
```

## Option 2: PostgreSQL Setup

### Install PostgreSQL

**Windows:**
```bash
# Download from: https://www.postgresql.org/download/windows/
# Or use Chocolatey:
choco install postgresql
```

**Mac:**
```bash
brew install postgresql
brew services start postgresql
```

**Linux:**
```bash
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### Setup Database

```bash
# Connect as postgres user
sudo -u postgres psql

# Create database and user
CREATE DATABASE filmbox;
CREATE USER filmbox_admin WITH PASSWORD 'secure_password_here';
GRANT ALL PRIVILEGES ON DATABASE filmbox TO filmbox_admin;

# Exit
\q

# Run schema
psql -U filmbox_admin -d filmbox < database/schema.sql
```

### Install Dependencies

```bash
npm install pg sequelize bcryptjs jsonwebtoken dotenv
```

### Configure Environment

```bash
cp .env.example .env

# Edit .env:
DB_TYPE=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=filmbox
DB_USER=filmbox_admin
DB_PASSWORD=secure_password_here
```

## Option 3: MySQL Setup

### Install MySQL

**Windows:**
```bash
# Download from: https://dev.mysql.com/downloads/mysql/
# Or use Chocolatey:
choco install mysql
```

**Mac:**
```bash
brew install mysql
brew services start mysql
```

**Linux:**
```bash
sudo apt-get install mysql-server
sudo systemctl start mysql
```

### Setup Database

```bash
# Connect to MySQL
mysql -u root -p

# Create database and user
CREATE DATABASE filmbox CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'filmbox_admin'@'localhost' IDENTIFIED BY 'secure_password_here';
GRANT ALL PRIVILEGES ON filmbox.* TO 'filmbox_admin'@'localhost';
FLUSH PRIVILEGES;

# Exit
exit

# Run schema
mysql -u filmbox_admin -p filmbox < database/schema.sql
```

### Install Dependencies

```bash
npm install mysql2 sequelize bcryptjs jsonwebtoken dotenv
```

### Configure Environment

```bash
cp .env.example .env

# Edit .env:
DB_TYPE=mysql
DB_HOST=localhost
DB_PORT=3306
DB_NAME=filmbox
DB_USER=filmbox_admin
DB_PASSWORD=secure_password_here
```

## Update server.js

Add at the top of your `server.js`:

```javascript
const { connectDB } = require('./database/connection');

// Connect to database on startup
connectDB().catch(err => {
  console.error('Failed to connect to database:', err);
  process.exit(1);
});
```

## Test Connection

Create a test file `test-db.js`:

```javascript
const { connectDB, disconnectDB } = require('./database/connection');
const { User, Profile } = require('./database/models');

async function testConnection() {
  try {
    await connectDB();
    console.log('✓ Database connection successful!');

    // Test creating a user
    const testUser = await User.create({
      email: 'test@example.com',
      passwordHash: 'test123' // Will be hashed automatically
    });
    console.log('✓ Test user created:', testUser.email);

    // Clean up
    await User.deleteOne({ email: 'test@example.com' });
    console.log('✓ Test user deleted');

    await disconnectDB();
  } catch (error) {
    console.error('✗ Database test failed:', error);
  }
}

testConnection();
```

Run test:
```bash
node test-db.js
```

## Migrate from localStorage

If you have existing users, run the migration:

```bash
# Create migration script (coming next)
node database/migrate-localstorage.js
```

## Security Checklist

Before going to production:

- [ ] Change `JWT_SECRET` in `.env`
- [ ] Change `SESSION_SECRET` in `.env`
- [ ] Use strong database password
- [ ] Enable SSL for database connections
- [ ] Set `NODE_ENV=production`
- [ ] Use HTTPS (not HTTP)
- [ ] Enable rate limiting on API endpoints
- [ ] Backup database regularly
- [ ] Don't commit `.env` to git

## Verify Installation

Start your server:
```bash
node server.js
```

You should see:
```
✓ MongoDB connected successfully
  Database: filmbox
  Host: localhost
Server běží na portu 3000
```

## Troubleshooting

### MongoDB Connection Failed
- Check if MongoDB is running: `mongosh`
- Verify URI in `.env`
- Check firewall settings

### PostgreSQL/MySQL Connection Failed
- Verify credentials in `.env`
- Check if database exists: `psql -l` or `mysql -e "SHOW DATABASES;"`
- Ensure database service is running

### Port Already in Use
- Change `PORT` in `.env` or close other apps using port 3000

## Next Steps

1. Update API endpoints to use database models
2. Implement authentication routes
3. Add middleware for protected routes
4. Update frontend to use API instead of localStorage
5. Test all features

For detailed API implementation, see `database/README.md`
