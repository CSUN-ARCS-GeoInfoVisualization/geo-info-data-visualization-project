# Quick Start - Database Setup on Localhost

## Prerequisites

Before running the setup, ensure you have:

1. **PostgreSQL 12+** installed with **PostGIS** extension
   - Download: https://www.postgresql.org/download/windows/
   - During installation, use Stack Builder to add PostGIS

2. **Python 3.8+** installed
   - Download: https://www.python.org/downloads/

3. **Git** installed (you already have this)

## One-Command Setup

### Option 1: Automated Setup (Recommended)

Open **PowerShell** in the project directory and run:

```powershell
powershell -ExecutionPolicy Bypass -File setup_database.ps1
```

This script will:
- Switch to core-database branch
- Create .env file from template
- Install Python dependencies
- Test database connection
- Run all migrations
- Verify setup

### Option 2: Manual Setup

If you prefer manual control:

#### 1. Create PostgreSQL Database

```bash
# Open Command Prompt
psql -U postgres
CREATE DATABASE wildfire_prediction;
\q
```

#### 2. Switch to Database Branch

```bash
cd "c:\Users\idoth\OneDrive\Desktop\Geo Info Data Visualization project\geo-info-data-visualization-project"
git checkout core-database
```

#### 3. Set Up Environment

```bash
# Copy environment template
copy .env.example .env

# Edit .env with your PostgreSQL password
notepad .env
```

Update this line in `.env`:
```
DB_PASSWORD=your_actual_postgres_password
```

#### 4. Install Dependencies

```bash
cd database
pip install -r requirements.txt
```

#### 5. Run Migrations

```bash
cd migrations
python run_migration.py
cd ..\..
```

## Verify Installation

Run the test script:

```bash
python database\test_db.py
```

Expected output:
```
============================================================
DATABASE CONNECTION TEST
============================================================

[Test 1/3] Testing database connection...
PostgreSQL connected: PostgreSQL 15.x...
PostGIS available: 3.x...
Connection test passed!

[Test 2/3] Testing data insertion...
Successfully inserted observation with ID: 1

[Test 3/3] Testing spatial query...
Found 1 observation(s) within 100km of San Francisco

============================================================
ALL TESTS PASSED!
============================================================
```

## What Gets Installed

### Python Packages
- `psycopg2-binary==2.9.9` - PostgreSQL database adapter
- `python-dotenv==1.0.1` - Environment variable management
- `SQLAlchemy==2.0.32` - SQL toolkit and ORM
- `GeoAlchemy2==0.14.2` - Spatial extensions for SQLAlchemy

### Database Schema
- **wildfire_observations** - Main table (partitioned by year 2013-2025)
- **seasons** - Lookup table for seasonal analysis
- **vegetation_types** - EPA ecosystem classifications
- **Spatial indexes** - GIST indexes for fast geographic queries

## Environment Variables

Your `.env` file should contain:

```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=wildfire_prediction
DB_USER=postgres
DB_PASSWORD=your_password_here

# Data Directories
DATA_DIR=./data

# API Keys (optional for now)
NASA_FIRMS_API_KEY=
NOAA_API_KEY=
USGS_API_KEY=

# Logging
LOG_QUERIES=False
```

## Troubleshooting

### PostgreSQL Not Installed

Download and install from:
https://www.postgresql.org/download/windows/

Make sure to install **PostGIS** extension via Stack Builder.

### Connection Refused

1. Check PostgreSQL service is running:
   - Open Windows Services
   - Look for "postgresql-x64-15" (or your version)
   - Ensure it's running

2. Verify port 5432 is not blocked by firewall

### PostGIS Not Found

```bash
psql -U postgres -d wildfire_prediction
CREATE EXTENSION postgis;
\q
```

### Wrong Password

Edit `.env` file and update `DB_PASSWORD` with your actual PostgreSQL password.

### Python Module Not Found

Make sure you're in the correct directory:
```bash
cd "c:\Users\idoth\OneDrive\Desktop\Geo Info Data Visualization project\geo-info-data-visualization-project\database"
```

## Next Steps

After successful setup:

1. **Import Data** - Use scripts from `ml-data-sources` branch to populate the database
2. **API Integration** - Connect with `API-framework` branch to expose REST endpoints
3. **Authentication** - Integrate with `user-auth` branch for secure access
4. **Visualization** - Set up QGIS or web mapping interface

## Documentation

- Full documentation: `database/README.md`
- Setup guide: `database/SETUP_GUIDE.md`
- Schema details: `database/schema/` folder

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review `database/README.md` for detailed documentation
3. Verify PostgreSQL is installed and running
4. Ensure all environment variables are set correctly
