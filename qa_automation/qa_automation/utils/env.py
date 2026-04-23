from __future__ import annotations

import os
from enum import Enum


class Env(str, Enum):
    STAGING = "staging"
    PRODUCTION = "production"


class App(str, Enum):
    FLIGHTHUB = "flighthub"
    JUSTFLY = "justfly"
    API_FLIGHTHUB = "api_flighthub"
    API_JUSTFLY = "api_justfly"
    SUMMIT = "summit"
    RESPRO = "respro"


def resolve_url(app: App, env: Env | None = None) -> str:
    if env is None:
        env = Env(os.getenv("QA_ENV", "staging").lower())

    if env == Env.PRODUCTION:
        return _PRODUCTION_URLS[app]

    prefix = os.environ["QA_STAGING_PREFIX"]
    return _STAGING_TEMPLATES[app].format(prefix=prefix)


_STAGING_TEMPLATES: dict[App, str] = {
    App.FLIGHTHUB: "https://{prefix}.flighthub.com",
    App.JUSTFLY: "https://{prefix}.justfly.com",
    App.API_FLIGHTHUB: "https://{prefix}-api.flighthub.com",
    App.API_JUSTFLY: "https://{prefix}-api.justfly.com",
    App.SUMMIT: "https://{prefix}-summit.flighthub.com",
    App.RESPRO: "https://reservations.voyagesalacarte.ca",  # same URL for staging and production
}

_PRODUCTION_URLS: dict[App, str] = {
    App.FLIGHTHUB: "https://www.flighthub.com",
    App.JUSTFLY: "https://www.justfly.com",
    App.API_FLIGHTHUB: "https://api.flighthub.com",
    App.API_JUSTFLY: "https://api.justfly.com",
    App.SUMMIT: "https://summit.flighthub.com",
    App.RESPRO: "https://reservations.voyagesalacarte.ca",
}
