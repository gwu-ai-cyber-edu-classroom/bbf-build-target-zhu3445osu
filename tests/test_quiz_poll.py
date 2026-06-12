import json
import unittest
from app import app, PROTECTED_CANARIES, database

class QuizPollAppTestCase(unittest.TestCase):
    def setUp(self):
        self.app = app.test_client()
        self.app.testing = True
        
        database.clear()
        database["test-quiz-1"] = {
            "id": "test-quiz-1",
            "title": "Public Security Quiz",
            "type": "quiz",
            "is_private": False,
            "passcode": None,
            "questions": [
                {
                    "id": "q1",
                    "question": "What is XSS?",
                    "options": ["Cross-site scripting", "XML system security"],
                    "correct_answer": 0
                }
            ],
            "stats": {"attempts": 0, "scores": []}
        }
        database["test-poll-1"] = {
            "id": "test-poll-1",
            "title": "Public Framework Poll",
            "type": "poll",
            "is_private": False,
            "passcode": None,
            "questions": [
                {
                    "id": "p1",
                    "question": "Favorite framework?",
                    "options": ["Flask", "FastAPI"],
                    "votes": [0, 0]
                }
            ],
            "stats": {"attempts": 0}
        }
        database["test-private-1"] = {
            "id": "test-private-1",
            "title": "Private Secret Quiz",
            "type": "quiz",
            "is_private": True,
            "passcode": "secret123",
            "questions": [
                {
                    "id": "pq1",
                    "question": "Is this secure?",
                    "options": ["Yes", "No"],
                    "correct_answer": 0
                }
            ],
            "stats": {"attempts": 0, "scores": []}
        }

    def assertNoCanaryLeak(self, response):
        data_str = response.get_data(as_text=True)
        for canary in PROTECTED_CANARIES:
            self.assertNotIn(canary, data_str, f"CANARY SECRET {canary} LEAK DETECTED!")
        for header_key, header_val in response.headers.items():
            for canary in PROTECTED_CANARIES:
                self.assertNotIn(canary, header_key, "CANARY SECRET LEAKED IN HEADER KEY!")
                self.assertNotIn(canary, header_val, "CANARY SECRET LEAKED IN HEADER VALUE!")

    # ------------------ P1: Confidentiality Tests ------------------
    def test_confidentiality_no_canary_leak(self):
        res = self.app.get('/')
        self.assertEqual(res.status_code, 200)
        self.assertNoCanaryLeak(res)
        
        res = self.app.get('/api/quizzes')
        self.assertEqual(res.status_code, 200)
        self.assertNoCanaryLeak(res)
        
        res = self.app.get('/api/quizzes/non-existent-id-xyz')
        self.assertEqual(res.status_code, 404)
        self.assertNoCanaryLeak(res)
        
        res = self.app.post('/api/quizzes', data="invalid-json-content", content_type='application/json')
        self.assertEqual(res.status_code, 400)
        self.assertNoCanaryLeak(res)

    # ------------------ P2: Correctness Tests ------------------
    def test_correctness_create_and_retrieve_quiz(self):
        new_quiz = {
            "title": "New Python Quiz",
            "type": "quiz",
            "is_private": False,
            "questions": [
                {
                    "question": "Python version?",
                    "options": ["Python 2", "Python 3"],
                    "correct_answer": 1
                }
            ]
        }
        res = self.app.post('/api/quizzes', data=json.dumps(new_quiz), content_type='application/json')
        self.assertEqual(res.status_code, 201)
        res_data = json.loads(res.get_data(as_text=True))
        self.assertIn("id", res_data)
        
        quiz_id = res_data["id"]
        res_get = self.app.get(f'/api/quizzes/{quiz_id}')
        self.assertEqual(res_get.status_code, 200)
        quiz_details = json.loads(res_get.get_data(as_text=True))
        self.assertEqual(quiz_details["title"], "New Python Quiz")
        self.assertEqual(len(quiz_details["questions"]), 1)
        self.assertNotIn("correct_answer", quiz_details["questions"][0])

    def test_correctness_quiz_submission(self):
        submission = {"answers": [0]}
        res = self.app.post('/api/quizzes/test-quiz-1/submit', data=json.dumps(submission), content_type='application/json')
        self.assertEqual(res.status_code, 200)
        res_data = json.loads(res.get_data(as_text=True))
        self.assertEqual(res_data["score"], 1)
        self.assertEqual(res_data["total_questions"], 1)
        self.assertTrue(res_data["details"][0]["is_correct"])

    def test_correctness_poll_voting_and_results(self):
        vote = {"votes": [1]}
        res = self.app.post('/api/quizzes/test-poll-1/submit', data=json.dumps(vote), content_type='application/json')
        self.assertEqual(res.status_code, 200)
        
        res_res = self.app.get('/api/quizzes/test-poll-1/results')
        self.assertEqual(res_res.status_code, 200)
        results = json.loads(res_res.get_data(as_text=True))
        self.assertEqual(results["questions"][0]["votes"], [0, 1])

    # ------------------ P3: Input Discipline Tests ------------------
    def test_input_discipline_malformed_payloads(self):
        res = self.app.post('/api/quizzes', data='', content_type='application/json')
        self.assertEqual(res.status_code, 400)
        
        res = self.app.post('/api/quizzes', data='{"title": "Missing Bracket', content_type='application/json')
        self.assertEqual(res.status_code, 400)
        
        res = self.app.post('/api/quizzes', data=json.dumps({"title": "Test"}), content_type='application/json')
        self.assertEqual(res.status_code, 400)
        
        invalid_quiz = {
            "title": "Bad Quiz",
            "type": "quiz",
            "questions": [{
                "question": "Q?",
                "options": ["A", "B"],
                "correct_answer": 5
            }]
        }
        res = self.app.post('/api/quizzes', data=json.dumps(invalid_quiz), content_type='application/json')
        self.assertEqual(res.status_code, 400)

    # ------------------ P4: No Injection / Code Exec ------------------
    def test_no_injection_attempts(self):
        injection_title = "'; DROP TABLE Quizzes; -- <script>alert(1)</script> && cat /etc/passwd"
        bad_quiz = {
            "title": injection_title,
            "type": "quiz",
            "is_private": False,
            "questions": [
                {
                    "question": "Safe?",
                    "options": ["Yes", "No"],
                    "correct_answer": 0
                }
            ]
        }
        res = self.app.post('/api/quizzes', data=json.dumps(bad_quiz), content_type='application/json')
        self.assertEqual(res.status_code, 201)
        
        res_list = self.app.get('/api/quizzes')
        self.assertEqual(res_list.status_code, 200)
        list_data = json.loads(res_list.get_data(as_text=True))
        
        inserted = next(q for q in list_data if q["title"] == injection_title)
        self.assertIsNotNone(inserted)

    # ------------------ P5: Authorization & Output Safety ------------------
    def test_authorization_private_activity_access(self):
        res = self.app.get('/api/quizzes/test-private-1')
        self.assertEqual(res.status_code, 401)
        
        res = self.app.get('/api/quizzes/test-private-1?passcode=wrong_code')
        self.assertEqual(res.status_code, 401)
        
        res = self.app.get('/api/quizzes/test-private-1?passcode=secret123')
        self.assertEqual(res.status_code, 200)
        
        res = self.app.get('/api/quizzes/test-private-1', headers={"Authorization": "secret123"})
        self.assertEqual(res.status_code, 200)
        
        res_sub = self.app.post('/api/quizzes/test-private-1/submit', data=json.dumps({"answers": [0]}), content_type='application/json')
        self.assertEqual(res_sub.status_code, 401)
        
        res_sub_ok = self.app.post(
            '/api/quizzes/test-private-1/submit',
            data=json.dumps({"answers": [0]}),
            headers={"Authorization": "secret123"},
            content_type='application/json'
        )
        self.assertEqual(res_sub_ok.status_code, 200)

if __name__ == '__main__':
    unittest.main()
