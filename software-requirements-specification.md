# Software Requirements Specification for Geo Info Data Visualization

**Target release:** 1.0  
**Epic:** CNP-7 - Requirement Engineering Done  
**Document status:** DRAFT  
**Document owner:** Ido Cohen  
**Tech lead:** Alex Hernandez-Abergo  
**Technical writers:** Ido Cohen, Alex Hernandez-Abergo, Sannia Jean, Tony Song, Ivan Lopez

## Table of Contents

- 1. Introduction
  - 1.1 Purpose
  - 1.2 Intended Audience and Intended Use
  - 1.3 Product Scope
  - 1.4 Definitions, Acronyms and Abbreviations
  - 1.5 References
- 2. Overall Description
  - 2.1 Product Perspective
  - 2.2 Product Functions
  - 2.3 User Classes and Characteristics
  - 2.4 Operating Environment
  - 2.5 Design and Implementation Constraints
  - 2.6 Assumptions and Dependencies
  - 2.7 User Documentation
- 3. System Features and Requirements
  - 3.1 System Feature 1: Risk Map Visualization
  - 3.2 System Feature 2: Prediction Service
  - 3.3 System Feature 3: Alerts & Notifications
  - 3.4 System Feature 4: Evac Routes
  - 3.5 System Feature 5: Data Ingestion & Processing
  - 3.6 System Feature 6: Administration
- 4. Nonfunctional Requirements
  - 4.1 Performance
  - 4.2 Safety
  - 4.3 Security
  - 4.4 Quality
  - 4.5 Maintainability
- 5. User Interaction and Design
- 6. Open Questions
- 7. Out of Scope

---

## 1. Introduction

### 1.1 Purpose

Define the requirements for a web-based system that predicts and visualizes wildfire risk for California regions, providing daily and weekly risk maps, alerts, and dual user views (Resident vs. Researcher). This SRS covers the full application (data pipeline, ML inference, APIs, and web UI).

### 1.2 Intended Audience and Intended Use

**Audience:** Data science team, System design team, instructors, stakeholders (residents, community safety officials), future developers/testers

**Use:** Primary reference for implementation and testing; onboarding guide for new contributors. Read section 2 for overview, section 3 for functional requirements, and section 4 for nonfunctional constraints.

### 1.3 Product Scope

Provide wildfire risk predictions (daily/weekly) using elevation, temperature, wind, vegetation, and fire history; visualize on interactive maps; issue alerts; support downloads and GIS layers for technical users. Benefits include preparedness, faster situational awareness, and research tooling.

### 1.4 Definitions, Acronyms and Abbreviations

- **DEM:** Digital Elevation Model
- **EVI/NDVI:** Vegetation indices from satellite data
- **LST:** Land Surface Temperature
- **FIRMS:** NASA Fire Information for Resource Management System
- **AOI:** Area of Interest
- **API:** Application Programming Interface

### 1.5 References

- Internal project docs, survey summaries, and interview notes (links to be added)
- Data dictionaries for each dataset (USGS DEM, NOAA weather, NASA FIRMS, MODIS EVI/NDVI)
- Coding standards and API contract (to be added in repo)

---

## 2. Overall Description

### 2.1 Product Perspective

New, self-contained system with two sub-teams: Data Science (data/ML) and System Design (APIs/web). External interfaces: public data sources (USGS/NOAA/NASA), optional SMS/email provider for alerts.

### 2.2 Product Functions

- Ingest & preprocess CA datasets (elevation, weather, vegetation, fire history)
- Train/serve ML models to produce per-region risk probabilities (daily/weekly)
- Visualize risk via map heatmaps and togglable GIS layers
- Send alerts/notifications during high-risk periods
- Provide downloads (reports/CSV/GeoTIFF) for researchers/students
- Admin tasks: data refresh, layer management, user/role management

### 2.3 User Classes and Characteristics

- **Residents (non-technical):** Need clear risk levels + simple alerts
- **Students/Researchers (technical):** Need layers, downloads, metadata

### 2.4 Operating Environment

- **Frontend:** Modern browsers (Chrome/Firefox/Safari/Edge)
- **Backend:** Python 3.x, Flask (or FastAPI), running on Linux VM/container
- **Data/ML:** Python, Jupyter, scikit-learn/XGBoost; optional TensorFlow/PyTorch for imagery
- **Optional cloud:** Colab/AWS/GCP for GPU training and hosting

### 2.5 Design and Implementation Constraints

- Public dataset licenses and rate limits
- Limited GPU availability; must support CPU inference for MVP
- Map tile quotas (if using third-party basemaps)
- Privacy constraints for user contact data (alerts)

### 2.6 Assumptions and Dependencies

- California focus for Phase 1; pipeline designed to generalize to other regions
- Availability of routinely updated weather and fire data
- Stakeholder willingness to receive alerts and share location at coarse granularity

### 2.7 User Documentation

- Quick start guide (Resident & Researcher)
- Admin manual (data refresh, layer management)
- API reference (prediction endpoints)

---

## 3. System Features and Requirements

### 3.1 System Feature 1: Risk Map Visualization (By: Alex)

#### 3.1.1 UR-1: Users shall view a color-coded wildfire risk map for a selected region/date range

- **SR-1.1:** The system shall render a base map with an overlay heatmap of risk probabilities
- **SR-1.2:** The system shall display a legend (Low/Med/High) and tooltips with numeric probability
- **SR-1.3:** The system shall allow pan/zoom without page reload

#### 3.1.2 UR-2: Users shall toggle GIS layers (vegetation index, temperature, wind, fire history, elevation)

- **SR-2.1:** The system shall provide layer visibility controls with on/off toggles
- **SR-2.2:** The system shall cache recently viewed tiles to reduce latency
- **SR-2.3:** The system shall show layer metadata (source, timestamp, resolution)

#### 3.1.3 UR-3: Users shall filter maps by date range

- **SR-3.1:** System shall provide calendar controls for daily/weekly predictions
- **SR-3.2:** System shall refresh risk maps when new dates are selected
- **SR-3.3:** System shall allow exporting a screenshot or small map tile

### 3.2 System Feature 2: Prediction Service (By: Alex)

#### 3.2.1 UR-4: Users shall request wildfire predictions for their region

- **SR-4.1:** API shall return risk probability for a region in JSON
- **SR-4.2:** API shall return prediction confidence intervals
- **SR-4.3:** API shall log all prediction requests for auditing

#### 3.2.2 UR-5: Users shall request batch predictions

- **SR-5.1:** API shall accept multiple regions/dates in one request
- **SR-5.2:** API shall provide a job ID for batch processing
- **SR-5.3:** API shall return a status + result download link

#### 3.2.3 UR-6: Users shall view model transparency info

- **SR-6.1:** System shall display which model version made the prediction
- **SR-6.2:** System shall display key contributing factors (e.g., weather, vegetation)
- **SR-6.3:** System shall provide a confidence score alongside predictions

### 3.3 System Feature 3: Alerts & Notifications (By: Ivan)

#### 3.3.1 UR-7: Users shall subscribe to wildfire risk alerts

- **SR-7.1:** System shall store user preferences (email/SMS, threshold)
- **SR-7.2:** System shall send daily or weekly updates
- **SR-7.3:** System shall allow unsubscribing or pausing alerts

#### 3.3.2 UR-8: Users shall receive alerts only when risk is above threshold

- **SR-8.1:** System shall compare predicted risk vs user threshold
- **SR-8.2:** System shall not send duplicate alerts within 24 hours
- **SR-8.3:** System shall log when alerts were sent and delivered

#### 3.3.3 UR-9: Admins shall configure alert rules

- **SR-9.1:** Admin shall set default thresholds for residents
- **SR-9.2:** Admin shall configure blackout times for alerting
- **SR-9.3:** Admin shall monitor an audit log of all alerts

### 3.4 System Feature 4: Evac Routes (By: Tony)

#### 3.4.1 UR-10: Users shall view suggested evacuation routes based on their current or selected location

- **SR-10.1:** The system shall allow users to input a location manually or use geolocation
- **SR-10.2:** The system shall display one or more evacuation routes on an interactive map with step-by-step directions
- **SR-10.3:** The system shall prioritize safer routes based on proximity to active/high-risk zones, road closures, and fire direction

#### 3.4.2 UR-11: Users shall filter evacuation routes based on transportation mode (car, walk)

- **SR-11.1:** The system shall provide route options driving and walking, with estimated time and distance
- **SR-11.2:** The system shall clearly label each route by mode and disable unavailable options
- **SR-11.3:** The system shall use a visual indicator (color-coded lines or icons) to differentiate transportation types

#### 3.4.3 UR-12: Users shall generate a customizable evacuation checklist based on household needs

- **SR-12.1:** The system shall allow users to select checklist categories (medical supplies, documents)
- **SR-12.2:** The system shall generate a printable/downloadable checklist
- **SR-12.3:** The system shall offer preset templates for common use cases

### 3.5 System Feature 5: Data Ingestion & Processing (By: Sannia)

#### 3.5.1 UR-13: Users shall be able to rely on the system to ingest wildfire-related datasets from multiple sources

- **SR-13.1:** Pipeline shall pull DEM, weather, vegetation, fire history data
- **SR-13.2:** Pipeline shall reproject all spatial layers to one CRS
- **SR-13.3:** Pipeline shall align rasters to the same resolution

#### 3.5.2 UR-14: User shall expect the system to clean and preprocess the data automatically

- **SR-14.1:** System shall handle missing values with interpolation/masking
- **SR-14.2:** System shall log preprocessing steps applied to each dataset
- **SR-14.3:** System shall validate datasets against schema (date, CRS, size)

#### 3.5.3 UR-15: Researchers shall be able to download processed datasets for analysis

- **SR-15.1:** System shall generate CSV and GeoTIFF reports
- **SR-15.2:** System shall attach metadata (date, model version)
- **SR-15.3:** System shall allow requesting subsets (by county or AOI)

### 3.6 System Feature 6: Administration (By: Ido)

#### 3.6.1 UR-16: Admins shall manage user accounts and roles

- **SR-16.1:** System shall support roles (Resident, Researcher, Admin)
- **SR-16.2:** System shall allow admins to reset passwords
- **SR-16.3:** System shall log all user role changes

#### 3.6.2 UR-17: Admins shall manage datasets and refresh schedules

- **SR-17.1:** System shall allow setting ingestion frequency (daily/weekly)
- **SR-17.2:** System shall show dashboard of ingestion jobs with status
- **SR-17.3:** System shall send alerts when a dataset fails to refresh

#### 3.6.3 UR-18: Admins shall configure visualization defaults

- **SR-18.1:** System shall allow setting default layers visible to new users
- **SR-18.2:** System shall allow changing the default basemap
- **SR-18.3:** System shall allow configuring thresholds for Low/Medium/High categories

---

## 4. Nonfunctional Requirements

### 4.1 Performance (By: Alex)

These requirements define how quickly the system should respond under typical usage. They ensure wildfire predictions and visualizations are usable in real time, especially during emergencies.

- **4.1.1:** The system shall render the initial wildfire risk map view and first 10 map tiles within 2 seconds on a 20 Mbps connection
- **4.1.2:** The system shall generate a wildfire prediction for a single region (AOI) within 1 second (if cached) or 5 seconds (if uncached)
- **4.1.3:** The system shall complete batch prediction jobs for up to 100 regions within 5 minutes under normal operating conditions

### 4.2 Safety (By: Ivan)

These requirements ensure that the system safeguards users and their data, prevents accidental data loss, and avoids misuse during critical situations like wildfire emergencies.

- **4.2.1:** The system shall display a safety disclaimer that predictions are advisory only and not a substitute for official evacuation orders
- **4.2.2:** The system shall maintain daily backups of models, data, and configurations, with restoration possible within 4 hours in case of system failure
- **4.2.3:** The system shall prevent accidental deletion of user accounts or records by requiring a confirmation page before such actions are completed

### 4.3 Security (By: Sannia)

These requirements ensure that sensitive user data and system operations are protected from unauthorized access, consistent with best practices for secure web systems.

- **4.3.1:** All communications between client and server shall be encrypted using TLS 1.2 or higher
- **4.3.2:** The system shall authenticate all users and store only minimal personally identifiable information (PII) necessary for alerts, with an option for users to delete their data
- **4.3.3:** The system shall maintain separate web servers and data servers, with network segmentation to prevent unauthorized access

### 4.4 Quality (By: Ido)

These requirements specify usability and reliability standards to ensure the system is robust, easy to use, and simple to extend by developers.

- **4.4.1:** The system shall have an availability of at least 99% uptime during wildfire season (June–October)
- **4.4.2:** New developers shall be able to set up a development environment in less than 1 hour using provided documentation
- **4.4.3:** At least 90% of resident test users shall correctly interpret the wildfire risk levels (Low/Medium/High) without additional instructions during usability testing

### 4.5 Maintainability (By: Tony)

These requirements define how easy it should be to maintain, update, and improve the system over time without disrupting service.

- **4.5.1:** The system shall provide automated test coverage of at least 80% of core features to ensure updates do not break functionality
- **4.5.2:** The system shall be modular, allowing new data sources or ML models to be added without requiring changes to existing components
- **4.5.3:** The system shall support continuous integration (CI) so that code changes are automatically tested and validated before deployment

---

## 5. User Interaction and Design

**Sitemap:**  
[https://www.figma.com/board/RuHL5mJEDaccTy7sMHhZ7D/Sitemap?node-id=0-1&t=DW3WJCtJgx7X3AJJ-1](https://www.figma.com/board/RuHL5mJEDaccTy7sMHhZ7D/Sitemap?node-id=0-1&t=DW3WJCtJgx7X3AJJ-1)

**Sketch:**  
[https://www.figma.com/board/lXd8UOF6yw4m9INXP7ecB2/Workflow-Sketch?node-id=0-1&t=7Kn54lMsrQW650d7-1](https://www.figma.com/board/lXd8UOF6yw4m9INXP7ecB2/Workflow-Sketch?node-id=0-1&t=7Kn54lMsrQW650d7-1)

---

## 6. Open Questions

| Question | Answer | Date Answered |
|----------|--------|---------------|
| How could we provide help for users to use this system? | We will compose a user manual and a system admin manual for different types of users. | 14 Feb 2022 |
| How often the system database should be updated? | Maybe once every month. | 15 Feb 2022 |
| Who should be responsible for updating the flight plan database? | The system admin. | 17 Feb 2022 |

---

## 7. Out of Scope

These features might be revisited in a later release:

- Real-time fire detection from live drone video (v2+)
- Evacuation routing and traffic modeling (reference only)
- Native mobile apps (web-first MVP)