import concurrent.futures
import json
import os
import tempfile
import unittest

import server


def document(session_ids=()):
    return {
        "version": 1,
        "exercises": [{"id": "squat", "name": "Squat", "group": "Jambes", "type": "charge"}],
        "sessions": [
            {"id": session_id, "date": "2026-07-10", "exos": [
                {"exoId": "squat", "sets": [{"reps": 8, "weight": 80}]}
            ]}
            for session_id in session_ids
        ],
    }


class StorageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        server.DATA_DIR = self.temp.name
        server.DATA = os.path.join(self.temp.name, "data.json")
        server.BACKUP = os.path.join(self.temp.name, "backup.json")
        server.write_data(document())

    def tearDown(self):
        self.temp.cleanup()

    def test_conditional_write_and_conflict(self):
        self.assertEqual(server.etag_for(server.read_data()), '"0"')
        result, saved = server.conditional_write(server.validate_data(document(["session-1"])), '"0"')
        self.assertEqual(result, "ok")
        self.assertEqual(saved["revision"], 1)

        result, current = server.conditional_write(server.validate_data(document(["session-2"])), '"0"')
        self.assertEqual(result, "conflict")
        self.assertEqual(current["sessions"][0]["id"], "session-1")

    def test_concurrent_writes_allow_only_one_revision(self):
        def put(session_id):
            result, _ = server.conditional_write(server.validate_data(document([session_id])), '"0"')
            return result

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = sorted(pool.map(put, ["session-a", "session-b"]))
        self.assertEqual(results, ["conflict", "ok"])
        self.assertEqual(server.read_data()["revision"], 1)

    def test_validation_rejects_malformed_documents(self):
        invalid = document()
        invalid["sessions"] = "not-a-list"
        with self.assertRaises(server.DataValidationError):
            server.validate_data(invalid)

        invalid = document(["session-1"])
        invalid["sessions"][0]["exos"][0]["sets"][0]["weight"] = float("inf")
        with self.assertRaises(server.DataValidationError):
            server.validate_data(invalid)

    def test_corrupt_primary_falls_back_to_valid_backup(self):
        server.conditional_write(server.validate_data(document(["session-1"])), '"0"')
        with open(server.DATA, "w", encoding="utf-8") as stream:
            stream.write("not-json")
        recovered = server.read_data()
        self.assertEqual(recovered["revision"], 0)
        self.assertEqual(recovered["sessions"], [])


if __name__ == "__main__":
    unittest.main()
