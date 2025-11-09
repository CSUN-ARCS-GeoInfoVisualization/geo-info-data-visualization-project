# simple settings holder. Dev = easier debugging. Prod = stricter
# SECRET_KEY is used by Flask for security (cookies/CSRF). Set via env

import os

class BaseConfig:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret") # defult for dev

class DevConfig(BaseConfig):
    DEBUG = True # auto-reload, debug messages

class ProdConfig(BaseConfig):
    DEBUG = False # no debug in production

def get_config(name=None):
    # pick which config to use based on FLASK_ENV (development/production)
    env = (name or os.getenv("FLASK_ENV", "development")).lower()
    return {
        "development": DevConfig,
        "production": ProdConfig,
    }.get(env,DevConfig)