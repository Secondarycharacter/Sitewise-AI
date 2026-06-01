import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from engine.regulation.law_config import (
    is_law_oc_configured,
    law_oc_from_mcp_config,
    resolve_law_api_protocol,
    resolve_law_oc,
    resolve_law_referer,
    resolve_law_user_agent,
)
from engine.regulation.law_openapi_client import LawOpenApiProvider, _api_error_message, _api_url
from engine.regulation.law_provider import KoreanLawMcpProvider


class LawOpenApiClientConfigTest(unittest.TestCase):
    def write_config(self, directory: str, value: str, extra_env: dict[str, str] | None = None) -> Path:
        config_path = Path(directory) / "mcp.json"
        env = {"LAW_OC": value, **(extra_env or {})}
        config_path.write_text(
            json.dumps(
                {
                    "mcpServers": {
                        "korean-law": {
                            "env": env
                        }
                    }
                }
            ),
            encoding="utf-8",
        )
        return config_path

    def test_reads_law_oc_from_mcp_config_env(self):
        with TemporaryDirectory() as directory:
            config_path = self.write_config(directory, "test-oc-value")

            self.assertEqual(law_oc_from_mcp_config(config_path), "test-oc-value")

    def test_missing_or_invalid_mcp_config_returns_empty_string(self):
        with TemporaryDirectory() as directory:
            self.assertEqual(law_oc_from_mcp_config(Path(directory) / "missing.json"), "")

    def test_environment_law_oc_takes_priority_over_mcp_config(self):
        with TemporaryDirectory() as directory:
            config_path = self.write_config(directory, "mcp-oc-value")
            with patch.dict(os.environ, {"LAW_OC": "env-oc-value"}):
                self.assertEqual(resolve_law_oc(config_path), "env-oc-value")

    def test_openapi_provider_uses_resolved_law_oc(self):
        with patch("engine.regulation.law_openapi_client.resolve_law_oc", return_value="resolved-oc"):
            provider = LawOpenApiProvider()

        self.assertTrue(provider.is_configured())
        self.assertEqual(provider.oc, "resolved-oc")

    def test_mcp_provider_reports_configured_when_law_oc_is_available(self):
        with patch("engine.regulation.law_provider.is_law_oc_configured", return_value=True):
            self.assertTrue(KoreanLawMcpProvider().is_configured())

    def test_is_law_oc_configured_uses_resolved_sources(self):
        with TemporaryDirectory() as directory:
            config_path = self.write_config(directory, "mcp-oc-value")
            with patch.dict(os.environ, {}, clear=True):
                self.assertTrue(is_law_oc_configured(config_path))

    def test_law_api_error_message_is_detected(self):
        message = _api_error_message(
            {
                "result": "필수입력요소 검증에 실패하였습니다.",
                "msg": "필수 입력값이 존재하지 않습니다.",
            }
        )

        self.assertIn("필수입력요소", message)
        self.assertIn("필수 입력값", message)

    def test_law_request_settings_can_come_from_mcp_config(self):
        with TemporaryDirectory() as directory:
            config_path = self.write_config(
                directory,
                "mcp-oc-value",
                {
                    "LAW_API_PROTOCOL": "http",
                    "LAW_REFERER": "https://example.test/",
                    "LAW_USER_AGENT": "test-agent",
                },
            )
            with patch.dict(os.environ, {}, clear=True):
                self.assertEqual(resolve_law_api_protocol(config_path), "http")
                self.assertEqual(resolve_law_referer(config_path), "https://example.test/")
                self.assertEqual(resolve_law_user_agent(config_path), "test-agent")

    def test_api_url_uses_configured_protocol(self):
        self.assertEqual(_api_url("http", "lawSearch.do"), "http://www.law.go.kr/DRF/lawSearch.do")


if __name__ == "__main__":
    unittest.main()
