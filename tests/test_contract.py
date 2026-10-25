import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "shimmory"

SAMPLE_EVENT = {
    "event.document": "0123456789abcdef0123456789abcdef",
    "event.start_time": "1761400000",
    "event.end_time": "1761401200",
    "event.duration_seconds": "1200",
    "event.start_progress_bp": "3500",
    "event.end_progress_bp": "4000",
    "event.progress_scale": "10000",
}


def render_body(values):
    device = json.loads((PACKAGE / "device.json").read_text(encoding="utf-8"))
    body = device["events"]["reader.session"]["request"]["body"]
    for key, value in values.items():
        body = body.replace("{" + key + "}", value)
    return body


def shimmory_mapping(payload):
    """Mirror of Shimmory's session mapping, to catch contract drift."""
    scale = payload["progress_scale"]
    start = round(payload["start_progress_bp"] * 100 / scale, 2)
    end = round(payload["end_progress_bp"] * 100 / scale, 2)
    return start, end, round(end - start, 2)


class ShimmoryContractTests(unittest.TestCase):
    def load_json(self, name: str):
        return json.loads((PACKAGE / name).read_text(encoding="utf-8"))

    def test_json_files_parse_and_examples_have_no_credentials(self):
        manifest = self.load_json("manifest.json")
        device = self.load_json("device.json")
        example = self.load_json("config.example.json")
        self.assertEqual(manifest["mount"], "settings")
        self.assertNotIn("password", json.dumps(manifest).lower())
        device_text = json.dumps(device)
        self.assertEqual(device_text.lower().count("password"), 1)
        self.assertIn("{cfg.password}", device_text)
        self.assertEqual(example["password"], "")
        self.assertEqual(example["username"], "")
        self.assertNotIn("deviceId", example)
        self.assertNotRegex(json.dumps(example), r"(?i)(secret|token|changeme)")

    def test_device_manifest_is_reader_session_events_only(self):
        manifest = self.load_json("manifest.json")
        self.assertRegex(manifest["version"], r"^\d+\.\d+\.\d+$")
        self.assertTrue(manifest["title"])
        self.assertTrue(manifest["description"])

        device = self.load_json("device.json")
        self.assertEqual(device["config"], {"file": "/.crosspoint/plugins/shimmory/config.json"})
        self.assertNotIn("browse", device)
        self.assertNotIn("auth", device)
        self.assertNotIn("token", device)
        self.assertEqual(set(device["events"]), {"reader.session"})
        handler = device["events"]["reader.session"]
        self.assertIs(handler["connect"], True)
        self.assertEqual(set(handler), {"request", "connect"})
        request = handler["request"]
        self.assertEqual(request["method"], "POST")
        self.assertEqual(request["url"], "{cfg.apiBase}/koreader/plugin/sessions")
        self.assertEqual(
            request["headers"],
            {
                "Content-Type": "application/json",
                "x-auth-user": "{cfg.username}",
                "x-auth-key": "{cfg.password}",
            },
        )

    def test_rendered_body_is_valid_json_with_exact_fields(self):
        body = render_body(SAMPLE_EVENT)
        self.assertNotRegex(body, r"\{(?:cfg|event)\.")
        self.assertLessEqual(len(body.encode()), 512)
        payload = json.loads(body)
        self.assertEqual(
            payload,
            {
                "document": "0123456789abcdef0123456789abcdef",
                "start_time": 1761400000,
                "end_time": 1761401200,
                "duration_seconds": 1200,
                "start_progress_bp": 3500,
                "end_progress_bp": 4000,
                "progress_scale": 10000,
            },
        )
        self.assertRegex(payload["document"], r"^[0-9a-f]{32}$")
        self.assertEqual(payload["duration_seconds"], payload["end_time"] - payload["start_time"])

    def test_mapping_matches_shimmory(self):
        payload = json.loads(render_body(SAMPLE_EVENT))
        self.assertEqual(shimmory_mapping(payload), (35.0, 40.0, 5.0))

    def test_browser_plugin_manual_contract_smoke(self):
        result = subprocess.run(
            ["node", str(ROOT / "tests" / "plugin_smoke.js")],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PLUGIN_SMOKE_PASS", result.stdout)

    def test_plugin_uses_safe_dom_and_only_documented_host_methods(self):
        source = (PACKAGE / "plugin.js").read_text(encoding="utf-8")
        self.assertNotIn("innerHTML", source)
        self.assertIn("CrossPoint.registerPlugin", source)
        methods = set(re.findall(r"\bapi\.([A-Za-z_$][\w$]*)", source))
        self.assertEqual(methods, {"writeFile", "pluginFile"})
        self.assertNotRegex(source, r"console\.(?:log|warn|error)")

    def test_package_builder_is_deterministic_and_exact(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / "plugin.zip"
            command = [sys.executable, str(ROOT / "scripts" / "build_package.py"), "--output", str(out)]
            subprocess.run(command, cwd=ROOT, check=True)
            first = out.read_bytes()
            subprocess.run(command, cwd=ROOT, check=True)
            second = out.read_bytes()
            self.assertEqual(hashlib.sha256(first).digest(), hashlib.sha256(second).digest())
            with zipfile.ZipFile(out) as archive:
                self.assertEqual(
                    archive.namelist(),
                    [
                        "shimmory/README.md",
                        "shimmory/config.example.json",
                        "shimmory/device.json",
                        "shimmory/manifest.json",
                        "shimmory/plugin.js",
                    ],
                )
                for info in archive.infolist():
                    self.assertEqual(info.date_time, (1980, 1, 1, 0, 0, 0))
                    self.assertEqual((info.external_attr >> 16) & 0o777, 0o644)


if __name__ == "__main__":
    unittest.main()
