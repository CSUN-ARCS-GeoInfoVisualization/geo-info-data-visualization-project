"""
Allowlisted syndicated sources for California fire-related news.

Each RSS/Atom entry is mapped to a trusted source_bucket for display.
Feeds are verified to be official government or agency endpoints.
"""

# National Weather Service: active alerts for California (Atom/CAP).
NWS_CA_ALERTS_ATOM = "https://api.weather.gov/alerts/active.atom?area=CA"

# CAL FIRE / statewide incidents (JSON API, not RSS).
CAL_FIRE_INCIDENTS_JSON = (
    "https://incidents.fire.ca.gov/umbraco/api/IncidentApi/List?inactive=false"
)

# Los Angeles Fire Department — regional fire updates (Drupal RSS).
LAFD_RSS = "https://lafd.org/rss.xml"

# California Governor's Office of Emergency Services — official alerts & news.
CAL_OES_NEWS_RSS = "https://www.news.caloes.ca.gov/feed/"

# (feed_url, source_bucket, default_category)
# default_category: breaking | updates | safety | research — refined by keyword rules in aggregator
RSS_FEED_SOURCES = [
    {
        "feed_url": LAFD_RSS,
        "source_bucket": "local_fire",
        "default_category": "updates",
        "source_label": "Los Angeles Fire Department",
    },
    {
        "feed_url": CAL_OES_NEWS_RSS,
        "source_bucket": "emergency",
        "default_category": "updates",
        "source_label": "Cal OES",
    },
]
