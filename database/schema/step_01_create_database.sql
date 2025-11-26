-- ============================================
-- STEP 1: Create Database and Enable PostGIS
-- ============================================
-- Run these commands first in psql or pgAdmin

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- Verify PostGIS is working
SELECT PostGIS_Version();
