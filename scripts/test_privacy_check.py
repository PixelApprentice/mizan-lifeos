import importlib.util
import pathlib
import unittest


spec = importlib.util.spec_from_file_location("privacy_check", pathlib.Path(__file__).with_name("check-private-data.py"))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class PrivacyCheckTests(unittest.TestCase):
    def problems(self, name, content=b""):
        return list(checker.issues(pathlib.PurePosixPath(name), content))

    def test_rejects_runtime_data(self):
        for name in ["mizan.db", "mizan.db-wal", "state/focus.json", "lifeos.json", "sessions.jsonl", "log/2030-01-01.md"]:
            with self.subTest(name=name):
                self.assertTrue(self.problems(name))

    def test_only_blank_tracker_template_is_allowed(self):
        self.assertEqual(self.problems("templates/tracker.csv", b"date,day,notes\n"), [])
        self.assertTrue(self.problems("templates/tracker.csv", b"date,day,notes\n2030-01-01,1,private\n"))
        self.assertTrue(self.problems("tracker.csv", b"date,day,notes\n"))

    def test_rejects_absolute_home_paths_without_echoing_them(self):
        self.assertEqual(self.problems("src/example.ts", b"/ho" + b"me/example/project/"), ["absolute user home path"])

    def test_recognizes_secret_shapes(self):
        self.assertEqual(self.problems("src/example.ts", b"ghp_" + b"a" * 36), ["possible credential"])

    def test_allows_portable_templates_and_source(self):
        self.assertEqual(self.problems("README.md", b"Store your logs in ~/Documents/lifeos."), [])
        self.assertEqual(self.problems("templates/day.md", b"# Day {{day}}\n\n## Plan\n"), [])

    def test_rejects_unreviewed_documents_and_images(self):
        self.assertTrue(self.problems("statement.pdf"))
        self.assertTrue(self.problems("public/private-photo.png"))
        self.assertEqual(self.problems("src-tauri/icons/32x32.png"), [])


if __name__ == "__main__":
    unittest.main()
