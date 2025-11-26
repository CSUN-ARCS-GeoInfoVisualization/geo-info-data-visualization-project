-- ============================================
-- STEP 4: Create Spatial and Performance Indexes
-- ============================================

-- Spatial indexes for each partition (PostGIS GIST)
-- These make geographic queries 20-50x faster
CREATE INDEX idx_obs_2013_location ON wildfire_observations_2013 USING GIST(location);
CREATE INDEX idx_obs_2014_location ON wildfire_observations_2014 USING GIST(location);
CREATE INDEX idx_obs_2015_location ON wildfire_observations_2015 USING GIST(location);
CREATE INDEX idx_obs_2016_location ON wildfire_observations_2016 USING GIST(location);
CREATE INDEX idx_obs_2017_location ON wildfire_observations_2017 USING GIST(location);
CREATE INDEX idx_obs_2018_location ON wildfire_observations_2018 USING GIST(location);
CREATE INDEX idx_obs_2019_location ON wildfire_observations_2019 USING GIST(location);
CREATE INDEX idx_obs_2020_location ON wildfire_observations_2020 USING GIST(location);
CREATE INDEX idx_obs_2021_location ON wildfire_observations_2021 USING GIST(location);
CREATE INDEX idx_obs_2022_location ON wildfire_observations_2022 USING GIST(location);
CREATE INDEX idx_obs_2023_location ON wildfire_observations_2023 USING GIST(location);
CREATE INDEX idx_obs_2024_location ON wildfire_observations_2024 USING GIST(location);
CREATE INDEX idx_obs_2025_location ON wildfire_observations_2025 USING GIST(location);

-- Date indexes for temporal queries
CREATE INDEX idx_obs_2013_date ON wildfire_observations_2013(observation_date);
CREATE INDEX idx_obs_2014_date ON wildfire_observations_2014(observation_date);
CREATE INDEX idx_obs_2015_date ON wildfire_observations_2015(observation_date);
CREATE INDEX idx_obs_2016_date ON wildfire_observations_2016(observation_date);
CREATE INDEX idx_obs_2017_date ON wildfire_observations_2017(observation_date);
CREATE INDEX idx_obs_2018_date ON wildfire_observations_2018(observation_date);
CREATE INDEX idx_obs_2019_date ON wildfire_observations_2019(observation_date);
CREATE INDEX idx_obs_2020_date ON wildfire_observations_2020(observation_date);
CREATE INDEX idx_obs_2021_date ON wildfire_observations_2021(observation_date);
CREATE INDEX idx_obs_2022_date ON wildfire_observations_2022(observation_date);
CREATE INDEX idx_obs_2023_date ON wildfire_observations_2023(observation_date);
CREATE INDEX idx_obs_2024_date ON wildfire_observations_2024(observation_date);
CREATE INDEX idx_obs_2025_date ON wildfire_observations_2025(observation_date);

-- Fire occurrence indexes (critical for model training queries)
CREATE INDEX idx_obs_2013_fire ON wildfire_observations_2013(fire_occurred);
CREATE INDEX idx_obs_2014_fire ON wildfire_observations_2014(fire_occurred);
CREATE INDEX idx_obs_2015_fire ON wildfire_observations_2015(fire_occurred);
CREATE INDEX idx_obs_2016_fire ON wildfire_observations_2016(fire_occurred);
CREATE INDEX idx_obs_2017_fire ON wildfire_observations_2017(fire_occurred);
CREATE INDEX idx_obs_2018_fire ON wildfire_observations_2018(fire_occurred);
CREATE INDEX idx_obs_2019_fire ON wildfire_observations_2019(fire_occurred);
CREATE INDEX idx_obs_2020_fire ON wildfire_observations_2020(fire_occurred);
CREATE INDEX idx_obs_2021_fire ON wildfire_observations_2021(fire_occurred);
CREATE INDEX idx_obs_2022_fire ON wildfire_observations_2022(fire_occurred);
CREATE INDEX idx_obs_2023_fire ON wildfire_observations_2023(fire_occurred);
CREATE INDEX idx_obs_2024_fire ON wildfire_observations_2024(fire_occurred);
CREATE INDEX idx_obs_2025_fire ON wildfire_observations_2025(fire_occurred);

-- Composite index for common query patterns (date + fire_occurred)
CREATE INDEX idx_obs_2013_date_fire ON wildfire_observations_2013(observation_date, fire_occurred);
CREATE INDEX idx_obs_2014_date_fire ON wildfire_observations_2014(observation_date, fire_occurred);
CREATE INDEX idx_obs_2015_date_fire ON wildfire_observations_2015(observation_date, fire_occurred);
CREATE INDEX idx_obs_2016_date_fire ON wildfire_observations_2016(observation_date, fire_occurred);
CREATE INDEX idx_obs_2017_date_fire ON wildfire_observations_2017(observation_date, fire_occurred);
CREATE INDEX idx_obs_2018_date_fire ON wildfire_observations_2018(observation_date, fire_occurred);
CREATE INDEX idx_obs_2019_date_fire ON wildfire_observations_2019(observation_date, fire_occurred);
CREATE INDEX idx_obs_2020_date_fire ON wildfire_observations_2020(observation_date, fire_occurred);
CREATE INDEX idx_obs_2021_date_fire ON wildfire_observations_2021(observation_date, fire_occurred);
CREATE INDEX idx_obs_2022_date_fire ON wildfire_observations_2022(observation_date, fire_occurred);
CREATE INDEX idx_obs_2023_date_fire ON wildfire_observations_2023(observation_date, fire_occurred);
CREATE INDEX idx_obs_2024_date_fire ON wildfire_observations_2024(observation_date, fire_occurred);
CREATE INDEX idx_obs_2025_date_fire ON wildfire_observations_2025(observation_date, fire_occurred);
