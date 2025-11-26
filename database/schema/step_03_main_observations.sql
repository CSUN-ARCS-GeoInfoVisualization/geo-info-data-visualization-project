-- ============================================
-- STEP 3: Main Wildfire Observations Table (Partitioned with Spatial Support)
-- ============================================

-- Parent table for partitioning by year
CREATE TABLE wildfire_observations (
    observation_id BIGSERIAL,
    observation_date DATE NOT NULL,
    location GEOGRAPHY(POINT, 4326) NOT NULL,  -- WGS84 coordinates for accurate distances
    
    -- Environmental features
    evi NUMERIC(8, 4) CHECK (evi BETWEEN -1 AND 1),  -- Enhanced Vegetation Index
    ndvi NUMERIC(8, 4) CHECK (ndvi BETWEEN -1 AND 1),  -- Normalized Difference Vegetation Index
    thermal_anomaly NUMERIC(6, 2),  -- Thermal anomaly level
    land_surface_temp NUMERIC(8, 2),  -- Land surface temperature (Kelvin or Celsius)
    wind_speed NUMERIC(5, 2) CHECK (wind_speed >= 0),  -- Wind speed (m/s or mph)
    elevation NUMERIC(7, 2),  -- Elevation in meters above sea level
    
    -- Fire occurrence
    fire_occurred BOOLEAN NOT NULL,
    
    -- Foreign keys to lookup tables
    vegetation_type_id INTEGER REFERENCES vegetation_types(vegetation_id),
    season_id INTEGER REFERENCES seasons(season_id),
    
    -- Metadata
    data_source VARCHAR(50),  -- Track data origin (satellite, sensor, model)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Computed columns for easier querying
    year INT GENERATED ALWAYS AS (EXTRACT(YEAR FROM observation_date)) STORED,
    month INT GENERATED ALWAYS AS (EXTRACT(MONTH FROM observation_date)) STORED,
    day_of_year INT GENERATED ALWAYS AS (EXTRACT(DOY FROM observation_date)) STORED,
    
    PRIMARY KEY (observation_id, observation_date)
) PARTITION BY RANGE (observation_date);

-- Create partitions for each year (2013-2025)
CREATE TABLE wildfire_observations_2013 PARTITION OF wildfire_observations
    FOR VALUES FROM ('2013-01-01') TO ('2014-01-01');

CREATE TABLE wildfire_observations_2014 PARTITION OF wildfire_observations
    FOR VALUES FROM ('2014-01-01') TO ('2015-01-01');

CREATE TABLE wildfire_observations_2015 PARTITION OF wildfire_observations
    FOR VALUES FROM ('2015-01-01') TO ('2016-01-01');

CREATE TABLE wildfire_observations_2016 PARTITION OF wildfire_observations
    FOR VALUES FROM ('2016-01-01') TO ('2017-01-01');

CREATE TABLE wildfire_observations_2017 PARTITION OF wildfire_observations
    FOR VALUES FROM ('2017-01-01') TO ('2018-01-01');

CREATE TABLE wildfire_observations_2018 PARTITION OF wildfire_observations
    FOR VALUES FROM ('2018-01-01') TO ('2019-01-01');

CREATE TABLE wildfire_observations_2019 PARTITION OF wildfire_observations
    FOR VALUES FROM ('2019-01-01') TO ('2020-01-01');

CREATE TABLE wildfire_observations_2020 PARTITION OF wildfire_observations
    FOR VALUES FROM ('2020-01-01') TO ('2021-01-01');

CREATE TABLE wildfire_observations_2021 PARTITION OF wildfire_observations
    FOR VALUES FROM ('2021-01-01') TO ('2022-01-01');

CREATE TABLE wildfire_observations_2022 PARTITION OF wildfire_observations
    FOR VALUES FROM ('2022-01-01') TO ('2023-01-01');

CREATE TABLE wildfire_observations_2023 PARTITION OF wildfire_observations
    FOR VALUES FROM ('2023-01-01') TO ('2024-01-01');

CREATE TABLE wildfire_observations_2024 PARTITION OF wildfire_observations
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

CREATE TABLE wildfire_observations_2025 PARTITION OF wildfire_observations
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
