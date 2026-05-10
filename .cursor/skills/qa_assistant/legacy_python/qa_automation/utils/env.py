from __future__ import annotations

import os
from enum import Enum
from urllib.parse import urlparse


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
        env = current_env()

    if env == Env.PRODUCTION:
        return _PRODUCTION_URLS[app]

    prefix = os.environ["QA_STAGING_PREFIX"]
    return _STAGING_TEMPLATES[app].format(prefix=prefix)


def current_env() -> Env:
    """Resolve the current Env from ``QA_ENV`` (default staging)."""
    return Env(os.getenv("QA_ENV", "staging").lower())


def env_from_url(url: str) -> Env:
    """Classify a URL as staging vs production based on the host.

    The current convention is:
      * ``staging<N>.flighthub.com`` / ``staging<N>.justfly.com`` (staging)
      * ``www.flighthub.com`` / ``www.justfly.com`` (production)

    Anything that doesn't start with ``staging`` is treated as production —
    we'd rather classify an unknown host as production (so the agent
    sees ``env=production`` in the run summary and can react accordingly)
    than silently call it staging. ``ResPro``
    (``reservations.voyagesalacarte.ca``) is shared between envs and is
    not classified by this helper; callers must pass ``Env`` explicitly
    for ResPro.
    """
    host = (urlparse(url).hostname or "").lower()
    if host.startswith("staging"):
        return Env.STAGING
    return Env.PRODUCTION


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
