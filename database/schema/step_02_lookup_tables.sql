-- ============================================
-- STEP 2: Create Lookup/Reference Tables
-- ============================================

-- Seasons lookup table for temporal analysis
CREATE TABLE seasons (
    season_id SERIAL PRIMARY KEY,
    season_name VARCHAR(20) UNIQUE NOT NULL,
    start_month INT NOT NULL CHECK (start_month BETWEEN 1 AND 12),
    end_month INT NOT NULL CHECK (end_month BETWEEN 1 AND 12),
    description TEXT,
    CONSTRAINT season_names CHECK (season_name IN ('Winter', 'Spring', 'Summer', 'Fall'))
);

-- Insert season definitions
INSERT INTO seasons (season_name, start_month, end_month, description) VALUES
('Winter', 12, 2, 'December through February - typically cooler, wetter conditions'),
('Spring', 3, 5, 'March through May - warming temperatures, variable moisture'),
('Summer', 6, 8, 'June through August - hot, dry conditions, peak fire season'),
('Fall', 9, 11, 'September through November - cooling temperatures, transitional conditions');

-- Vegetation cover types (EPA ecosystems classification)
CREATE TABLE vegetation_types (
    vegetation_id SERIAL PRIMARY KEY,
    vegetation_code VARCHAR(10) UNIQUE NOT NULL,
    vegetation_name VARCHAR(100) NOT NULL,
    fire_risk_level VARCHAR(20) CHECK (fire_risk_level IN ('Low', 'Moderate', 'High', 'Extreme')),
    description TEXT
);

-- Sample vegetation types - expand based on EPA ecosystem data
INSERT INTO vegetation_types (vegetation_code, vegetation_name, fire_risk_level, description) VALUES
('SHRUB', 'Shrubland/Chaparral', 'Extreme', 'Dense shrubs, highly flammable'),
('GRASS', 'Grassland', 'High', 'Dry grasses, rapid fire spread'),
('FOREST', 'Forest/Woodland', 'Moderate', 'Mixed trees and understory'),
('AGRIC', 'Agriculture', 'Low', 'Cultivated lands, irrigated'),
('URBAN', 'Urban/Developed', 'Low', 'Built environment'),
('BARREN', 'Barren/Sparse', 'Low', 'Minimal vegetation');
