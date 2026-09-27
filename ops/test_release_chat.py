"""Offline checks for the nginx loader upgrade and the widget archive gate.

python -m unittest ops/test_release_chat.py   (runs on Windows too: no server access)
"""
import hashlib, json, pathlib, subprocess, sys, tempfile, unittest
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import release_chat as rc

NGINX = (
    "server {\n"
    "    # Widget API -> API 3010\n"
    "    location /api/widget/ {\n        proxy_pass http://127.0.0.1:3010;\n    }\n"
    "    # Widget files\n"
    "    location /widget/ {\n        alias /var/www/widget/;\n    }\n"
    "    location / {\n        proxy_pass http://127.0.0.1:3000;\n    }\n"
    "}\n"
)
OLD, NEW = "loader.v8-0196e48de6d8dcca.js", "loader.v8-aaaaaaaaaaaaaaaa.js"


class InstallRoutes(unittest.TestCase):
    def test_first_install_adds_routes_loader_and_static_block(self):
        text = rc.install_routes(NGINX, OLD)
        self.assertIn("location /api/chat-v8/ {", text)
        self.assertIn(rc.loader_block(OLD), text)
        self.assertEqual(text.count("location = /widget/widget.min.js {"), 1)

    def test_upgrade_changes_only_the_loader_filename(self):
        live = rc.install_routes(NGINX, OLD)
        upgraded = rc.install_routes(live, NEW)
        changed = [(a, b) for a, b in zip(live.splitlines(), upgraded.splitlines()) if a != b]
        self.assertEqual(len(live.splitlines()), len(upgraded.splitlines()))
        self.assertEqual(len(changed), 1)
        self.assertEqual(changed[0][1], changed[0][0].replace(OLD, NEW))
        self.assertEqual(rc.install_routes(upgraded, NEW), upgraded)

    def test_hand_edited_block_is_refused(self):
        live = rc.install_routes(NGINX, OLD).replace("sub_filter_once on;", "sub_filter_once off;")
        with self.assertRaises(RuntimeError):
            rc.install_routes(live, NEW)

    def test_unexpected_loader_name_is_refused(self):
        with self.assertRaises(RuntimeError):
            rc.install_routes(NGINX, "loader.js")


class WidgetArchive(unittest.TestCase):
    def build(self, folder, tar_command):
        files = {"widget.js": b"/* source */", "widget.v8-1111111111111111.min.js": b"/* bundle */", NEW: b"/* loader */"}
        for name, data in files.items():
            (folder / name).write_bytes(data)
        manifest = {"version": "t", "source_file": "widget.js", "bundle_file": "widget.v8-1111111111111111.min.js", "loader_file": NEW,
                    "files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
        (folder / "widget-release.json").write_text(json.dumps(manifest))
        archive = folder.parent / "widget-release.tgz"
        subprocess.run([tar_command, "-czf", str(archive), "-C", str(folder), *files, "widget-release.json"], check=True)
        return archive

    def test_archive_made_by_system_tar_passes_the_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = pathlib.Path(tmp) / "src"
            folder.mkdir()
            archive = self.build(folder, "tar")
            manifest = rc.unpack_widget(archive, rc.sha(archive), pathlib.Path(tmp) / "out")
            self.assertEqual(manifest["loader_file"], NEW)

    def test_digest_mismatch_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = pathlib.Path(tmp) / "src"
            folder.mkdir()
            archive = self.build(folder, "tar")
            with self.assertRaises(RuntimeError):
                rc.unpack_widget(archive, "0" * 64, pathlib.Path(tmp) / "out")


if __name__ == "__main__":
    unittest.main()
