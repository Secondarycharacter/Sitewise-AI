"""Configuration helpers for Korean law integrations."""

from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


def law_oc_from_mcp_config(config_path: Path | None = None) -> str:
    return law_env_from_mcp_config("LAW_OC", config_path)


def law_env_from_mcp_config(key: str, config_path: Path | None = None) -> str:
    path = config_path or (ROOT / ".cursor" / "mcp.json")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""

    servers = payload.get("mcpServers")
    if not isinstance(servers, dict):
        return ""

    for server in servers.values():
        if not isinstance(server, dict):
            continue
        env = server.get("env")
        if not isinstance(env, dict):
            continue
        value = str(env.get(key) or "").strip()
        if value:
            return value
    return ""


def resolve_law_oc(config_path: Path | None = None) -> str:
    return os.getenv("LAW_OC", "").strip() or law_oc_from_mcp_config(config_path)


def is_law_oc_configured(config_path: Path | None = None) -> bool:
    return bool(resolve_law_oc(config_path))


def resolve_law_setting(
    key: str,
    default: str = "",
    config_path: Path | None = None,
) -> str:
    return os.getenv(key, "").strip() or law_env_from_mcp_config(key, config_path) or default


def resolve_law_api_protocol(config_path: Path | None = None) -> str:
    value = resolve_law_setting("LAW_API_PROTOCOL", "https", config_path).lower()
    return value if value in ("http", "https") else "https"


def resolve_law_referer(config_path: Path | None = None) -> str:
    return resolve_law_setting("LAW_REFERER", "https://www.law.go.kr/", config_path)


def resolve_law_user_agent(config_path: Path | None = None) -> str:
    return resolve_law_setting(
        "LAW_USER_AGENT",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        config_path,
    )
