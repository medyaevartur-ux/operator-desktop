"""Offline checks for the operator web archive gate.

python -m unittest ops/test_operator_web.py   (runs on Windows too: no server access)
"""
import hashlib, io, pathlib, sys, tarfile, tempfile, unittest
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import operator_web as ow

SHELL = ['./index.html', './sw.js', './manifest.webmanifest', './apple-touch-icon.png', './assets/index-abc.js']


def archive(folder, names):
    path = pathlib.Path(folder) / 'operator-web.tgz'
    with tarfile.open(path, 'w:gz') as bundle:
        for name in names:
            data = name.encode()
            info = tarfile.TarInfo(name); info.size = len(data)
            bundle.addfile(info, io.BytesIO(data))
    return path, hashlib.sha256(path.read_bytes()).hexdigest()


class Unpack(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        ow.RELEASES = pathlib.Path(self.folder.name) / 'releases'
        ow.RELEASES.mkdir()

    def tearDown(self):
        self.folder.cleanup()

    def test_vite_build_layout_is_published(self):
        path, digest = archive(self.folder.name, SHELL)
        release = ow.unpack(path, digest)
        self.assertEqual((release / 'assets' / 'index-abc.js').read_text(), './assets/index-abc.js')
        self.assertEqual([item.name for item in ow.releases()], [release.name])

    def test_path_outside_the_release_is_refused(self):
        path, digest = archive(self.folder.name, SHELL + ['../../etc/nginx/evil.conf'])
        with self.assertRaises(SystemExit): ow.unpack(path, digest)
        self.assertEqual(ow.releases(), [])

    def test_build_without_the_iphone_icon_is_refused(self):
        path, digest = archive(self.folder.name, [name for name in SHELL if 'apple' not in name])
        with self.assertRaisesRegex(SystemExit, 'apple-touch-icon.png'): ow.unpack(path, digest)

    def test_archive_changed_after_review_is_refused(self):
        path, _ = archive(self.folder.name, SHELL)
        with self.assertRaisesRegex(SystemExit, 'SHA256'): ow.unpack(path, '0' * 64)


if __name__ == '__main__':
    unittest.main()
