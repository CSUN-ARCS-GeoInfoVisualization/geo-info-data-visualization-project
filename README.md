# Geo Info Data Visualization Project

Wildfire prediction and geospatial visualization senior research project at California State University, Northridge.

## Overview

This project aims to help residents and researchers understand wildfire risk across California by combining:

- geospatial data ingestion and preprocessing,
- machine learning risk prediction,
- map-based visualization,
- alerts and notifications.

The system is documented in `software-requirements-specification.md` and is currently in active development.

## Team

- Ido Cohen
- Alex Hernandez-Abergo
- Ivan Lopez
- Tony Song
- Sannia Jean

## Repository Structure

Current top-level folders:

- `frontend/` - Web UI (map visualization, user workflows, reusable UI components)
- `backend/` - API routes and backend service logic
- `api-framework/` - API framework/app scaffolding

Supporting docs:

- `software-requirements-specification.md` - Full SRS (features, requirements, constraints)
- `README.md` - Project entry point and contribution guide

## Planned Core Features

- Risk map visualization with date filters and GIS layer toggles
- Prediction API for single and batch wildfire risk requests
- Alerts/notifications based on user-defined risk thresholds
- Data ingestion pipeline for weather, vegetation, elevation, and fire history data
- Admin workflows for refresh schedules and configuration

## Current Status

This repository currently contains project scaffolding and requirements documentation.

Implementation of frontend/backend modules is in progress.

## Getting Started (Development)

Because this repository is still being scaffolded, there is not yet a single runnable startup command.

Recommended initial setup:

1. Clone the repository.
2. Create and activate a Python virtual environment.
3. Add dependencies as the backend and API modules are implemented.
4. Add frontend package setup once the frontend app bootstrap is committed.

## Workflow Guidelines

- Use feature branches for new work.
- Keep pull requests focused and small.
- Update documentation when requirements or architecture change.
- Keep code aligned with the SRS feature definitions.

## Documentation

- Software requirements: `software-requirements-specification.md`
- UI planning and workflow links are documented in the SRS.

## Roadmap (MVP Focus)

1. Establish backend API contracts for prediction and map layer data.
2. Build map visualization UI and connect API integration.
3. Implement model inference pipeline and baseline prediction service.
4. Add alerts/notification preferences and delivery flow.
5. Expand test coverage for core user and API paths.

## License

No license has been declared yet.

If this project will be shared publicly, add a license file before release.

