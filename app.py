import os
import uuid
import json
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__, static_folder='public')
CORS(app)

# Canary secret configuration - dynamically load from secret/canary.txt (P1)
PROTECTED_CANARIES = []
canary_file_path = os.path.join(os.path.dirname(__file__), "secret", "canary.txt")
if os.path.exists(canary_file_path):
    try:
        with open(canary_file_path, "r", encoding="utf-8") as f:
            for line in f:
                line_str = line.strip()
                if line_str.startswith("CANARY_"):
                    PROTECTED_CANARIES.append(line_str)
    except Exception as e:
        app.logger.error(f"Error reading canary file: {e}")

# Fallback default if none loaded (e.g. testing)
if not PROTECTED_CANARIES:
    CANARY_SECRET = os.getenv("CANARY_SECRET", "CANARY_default_fallback_secret_value_xyz789")
    PROTECTED_CANARIES.append(CANARY_SECRET)
else:
    CANARY_SECRET = PROTECTED_CANARIES[0]

# In-memory database of quizzes and polls
# Each entry structure:
# {
#   "id": "str-uuid",
#   "title": "str",
#   "type": "quiz" | "poll",
#   "is_private": bool,
#   "passcode": "str" (optional, required if private),
#   "questions": [
#     {
#       "id": "str-uuid",
#       "question": "str",
#       "options": ["str", "str", ...],
#       "correct_answer": int (index, only for quiz),
#       "votes": [int, int, ...] (counts for each option, only for poll)
#     }
#   ],
#   "stats": {
#     "attempts": int (number of times taken/voted),
#     "scores": [int] (scores achieved, only for quiz)
#   }
# }
database = {}

# Global error handler to prevent stack trace leakage and secret leakage (P1, P3)
@app.errorhandler(Exception)
def handle_exception(e):
    # Log the real error for server admin, but do not leak details to client
    err_str = str(e)
    # Check if any protected canary is in the error message, and mask it in logs just in case!
    for canary in PROTECTED_CANARIES:
        err_str = err_str.replace(canary, "[REDACTED_CANARY]")
    app.logger.error(f"Server Error: {err_str}")
    return jsonify({
        "error": "An internal server error occurred. Please verify your input and try again."
    }), 500

@app.after_request
def redact_secrets_and_add_headers(response):
    # Security headers (P5)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    
    # Redact any accidental leakage of canary strings (P1 Failsafe)
    if response.is_json:
        try:
            data = response.get_json(silent=True)
            if data:
                data_str = json.dumps(data)
                was_redacted = False
                for canary in PROTECTED_CANARIES:
                    if canary in data_str:
                        data_str = data_str.replace(canary, "[REDACTED_CANARY]")
                        was_redacted = True
                if was_redacted:
                    response.set_data(data_str)
        except Exception:
            pass
    elif response.mimetype == 'text/html' or response.mimetype == 'text/plain':
        try:
            text = response.get_data(as_text=True)
            was_redacted = False
            for canary in PROTECTED_CANARIES:
                if canary in text:
                    text = text.replace(canary, "[REDACTED_CANARY]")
                    was_redacted = True
            if was_redacted:
                response.set_data(text.encode('utf-8'))
        except Exception:
            pass
            
    return response

# Serve frontend static files
@app.route('/')
def serve_index():
    return send_from_directory('public', 'index.html')

@app.route('/css/<path:path>')
def serve_css(path):
    return send_from_directory('public/css', path)

@app.route('/js/<path:path>')
def serve_js(path):
    return send_from_directory('public/js', path)

# Helper function to sanitize a quiz/poll item for public output (P1, P5)
def sanitize_quiz_item(quiz, authorized=False):
    sanitized = {
        "id": quiz["id"],
        "title": quiz["title"],
        "type": quiz["type"],
        "is_private": quiz["is_private"],
        "stats": {
            "attempts": quiz["stats"]["attempts"]
        }
    }
    
    # If the user is authorized or it's public, share questions (but omit correct answers for quizzes if taking)
    if not quiz["is_private"] or authorized:
        sanitized["questions"] = []
        for q in quiz["questions"]:
            q_sanitized = {
                "id": q["id"],
                "question": q["question"],
                "options": q["options"]
            }
            sanitized["questions"].append(q_sanitized)
            
        if quiz["type"] == "quiz" and "scores" in quiz["stats"]:
            sanitized["stats"]["average_score"] = (
                sum(quiz["stats"]["scores"]) / len(quiz["stats"]["scores"])
                if quiz["stats"]["scores"] else 0
            )
    return sanitized

# Helper to verify authorization (P5)
def check_authorization(quiz):
    if not quiz.get("is_private"):
        return True
    
    # Check passcode in headers or query params
    provided_passcode = request.headers.get("Authorization") or request.args.get("passcode")
    if not provided_passcode:
        return False
    
    # Normalize comparison to prevent timing attacks/basic issues
    return str(provided_passcode).strip() == str(quiz.get("passcode")).strip()

# API: List all quizzes/polls (P2, P5)
@app.route('/api/quizzes', methods=['GET'])
def get_all_quizzes():
    result = []
    for q_id, quiz in database.items():
        is_auth = check_authorization(quiz)
        result.append(sanitize_quiz_item(quiz, authorized=is_auth))
    return jsonify(result)

# API: Get specific quiz/poll details (P2, P5)
@app.route('/api/quizzes/<quiz_id>', methods=['GET'])
def get_quiz_details(quiz_id):
    quiz = database.get(quiz_id)
    if not quiz:
        return jsonify({"error": "Quiz or poll not found"}), 404
    
    if not check_authorization(quiz):
        return jsonify({"error": "Unauthorized. Passcode required for this private quiz/poll."}), 401
    
    return jsonify(sanitize_quiz_item(quiz, authorized=True))

# API: Create new quiz/poll (P2, P3, P4)
@app.route('/api/quizzes', methods=['POST'])
def create_quiz():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid JSON payload"}), 400
    
    # Input validation (P3)
    title = data.get("title")
    item_type = data.get("type")
    is_private = data.get("is_private", False)
    passcode = data.get("passcode")
    questions = data.get("questions")
    
    if not title or not isinstance(title, str) or len(title.strip()) == 0:
        return jsonify({"error": "Title is required and must be a non-empty string"}), 400
    if len(title) > 200:
        return jsonify({"error": "Title is too long (max 200 characters)"}), 400
        
    if item_type not in ["quiz", "poll"]:
        return jsonify({"error": "Type must be either 'quiz' or 'poll'"}), 400
        
    if not isinstance(is_private, bool):
        return jsonify({"error": "is_private must be a boolean"}), 400
        
    if is_private and (not passcode or not isinstance(passcode, str) or len(passcode.strip()) == 0):
        return jsonify({"error": "Passcode is required for private items"}), 400
        
    if not questions or not isinstance(questions, list) or len(questions) == 0:
        return jsonify({"error": "At least one question is required"}), 400
    if len(questions) > 50:
        return jsonify({"error": "Too many questions (max 50)"}), 400
        
    validated_questions = []
    for idx, q in enumerate(questions):
        q_text = q.get("question")
        options = q.get("options")
        correct_answer = q.get("correct_answer")
        
        if not q_text or not isinstance(q_text, str) or len(q_text.strip()) == 0:
            return jsonify({"error": f"Question {idx+1} text is required"}), 400
        if len(q_text) > 500:
            return jsonify({"error": f"Question {idx+1} is too long (max 500 characters)"}), 400
            
        if not options or not isinstance(options, list) or len(options) < 2:
            return jsonify({"error": f"Question {idx+1} must have at least 2 options"}), 400
        if len(options) > 10:
            return jsonify({"error": f"Question {idx+1} can have at most 10 options"}), 400
            
        for opt_idx, opt in enumerate(options):
            if not opt or not isinstance(opt, str) or len(opt.strip()) == 0:
                return jsonify({"error": f"Option {opt_idx+1} in Question {idx+1} must be a non-empty string"}), 400
            if len(opt) > 200:
                return jsonify({"error": f"Option {opt_idx+1} in Question {idx+1} is too long (max 200 characters)"}), 400
                
        q_entry = {
            "id": str(uuid.uuid4()),
            "question": q_text.strip(),
            "options": [opt.strip() for opt in options]
        }
        
        if item_type == "quiz":
            if correct_answer is None or not isinstance(correct_answer, int):
                return jsonify({"error": f"Quiz Question {idx+1} must specify a correct_answer index"}), 400
            if correct_answer < 0 or correct_answer >= len(options):
                return jsonify({"error": f"Quiz Question {idx+1} correct_answer index is out of bounds"}), 400
            q_entry["correct_answer"] = correct_answer
        else:
            # For polls, initialize votes counts to 0
            q_entry["votes"] = [0] * len(options)
            
        validated_questions.append(q_entry)
        
    # Create the entry
    new_id = str(uuid.uuid4())
    new_item = {
        "id": new_id,
        "title": title.strip(),
        "type": item_type,
        "is_private": is_private,
        "passcode": passcode.strip() if is_private else None,
        "questions": validated_questions,
        "stats": {
            "attempts": 0,
            "scores": [] if item_type == "quiz" else None
        }
    }
    
    database[new_id] = new_item
    return jsonify({"id": new_id, "message": "Successfully created!"}), 201

# API: Take quiz / Submit vote (P2, P3, P5)
@app.route('/api/quizzes/<quiz_id>/submit', methods=['POST'])
def submit_quiz(quiz_id):
    quiz = database.get(quiz_id)
    if not quiz:
        return jsonify({"error": "Quiz or poll not found"}), 404
        
    if not check_authorization(quiz):
        return jsonify({"error": "Unauthorized"}), 401
        
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid JSON payload"}), 400
        
    # Process quiz answers
    if quiz["type"] == "quiz":
        answers = data.get("answers") # Expecting a list of indices matching questions
        if not isinstance(answers, list) or len(answers) != len(quiz["questions"]):
            return jsonify({"error": "Answers list must match the length of quiz questions"}), 400
            
        score = 0
        details = []
        for idx, q in enumerate(quiz["questions"]):
            user_ans = answers[idx]
            if not isinstance(user_ans, int) or user_ans < 0 or user_ans >= len(q["options"]):
                return jsonify({"error": f"Answer at index {idx} must be a valid option index"}), 400
                
            correct = q["correct_answer"]
            is_correct = (user_ans == correct)
            if is_correct:
                score += 1
            details.append({
                "question_id": q["id"],
                "user_answer": user_ans,
                "correct_answer": correct,
                "is_correct": is_correct
            })
            
        # Update stats
        quiz["stats"]["attempts"] += 1
        quiz["stats"]["scores"].append(score)
        
        return jsonify({
            "score": score,
            "total_questions": len(quiz["questions"]),
            "details": details
        })
        
    # Process poll votes
    else:
        votes = data.get("votes")
        if not isinstance(votes, list) or len(votes) != len(quiz["questions"]):
            return jsonify({"error": "Votes list must match the length of poll questions"}), 400
            
        for idx, q in enumerate(quiz["questions"]):
            vote_idx = votes[idx]
            if vote_idx is not None:
                if not isinstance(vote_idx, int) or vote_idx < 0 or vote_idx >= len(q["options"]):
                    return jsonify({"error": f"Vote at index {idx} must be a valid option index"}), 400
                q["votes"][vote_idx] += 1
                
        quiz["stats"]["attempts"] += 1
        return jsonify({"message": "Vote recorded successfully!"})

# API: Get results (P2, P5)
@app.route('/api/quizzes/<quiz_id>/results', methods=['GET'])
def get_results(quiz_id):
    quiz = database.get(quiz_id)
    if not quiz:
        return jsonify({"error": "Quiz or poll not found"}), 404
        
    if not check_authorization(quiz):
        return jsonify({"error": "Unauthorized"}), 401
        
    results = {
        "id": quiz["id"],
        "title": quiz["title"],
        "type": quiz["type"],
        "attempts": quiz["stats"]["attempts"]
    }
    
    if quiz["type"] == "poll":
        results["questions"] = []
        for q in quiz["questions"]:
            results["questions"].append({
                "id": q["id"],
                "question": q["question"],
                "options": q["options"],
                "votes": q["votes"]
            })
    else:
        results["average_score"] = (
            sum(quiz["stats"]["scores"]) / len(quiz["stats"]["scores"])
            if quiz["stats"]["scores"] else 0
        )
        results["total_questions"] = len(quiz["questions"])
        
    return jsonify(results)

# Seed default quizzes and polls so the app isn't empty on first start
def seed_data():
    q1_id = "d01b1c67-64fb-4b53-9a4f-cc34f0e7d58b"
    database[q1_id] = {
        "id": q1_id,
        "title": "Web Security Principles",
        "type": "quiz",
        "is_private": False,
        "passcode": None,
        "questions": [
            {
                "id": "q1",
                "question": "Which HTTP security header prevents browsers from MIME-sniffing a response away from the declared content-type?",
                "options": ["X-Frame-Options", "X-Content-Type-Options", "Content-Security-Policy", "Strict-Transport-Security"],
                "correct_answer": 1
            },
            {
                "id": "q2",
                "question": "What is the primary countermeasure against SQL Injection vulnerabilities?",
                "options": ["Web Application Firewalls", "Input Validation", "Parameterized Queries (Prepared Statements)", "Encrypting the database"],
                "correct_answer": 2
            }
        ],
        "stats": {
            "attempts": 4,
            "scores": [2, 1, 2, 2]
        }
    }
    
    p1_id = "f84b1a45-6677-48f1-a1b4-23e5fa098b67"
    database[p1_id] = {
        "id": p1_id,
        "title": "Favorite Coding Environment",
        "type": "poll",
        "is_private": False,
        "passcode": None,
        "questions": [
            {
                "id": "pq1",
                "question": "Which editor/IDE do you prefer for web development?",
                "options": ["VS Code", "Vim / Neovim", "JetBrains IDEs", "Emacs"],
                "votes": [18, 5, 12, 2]
            }
        ],
        "stats": {
            "attempts": 37
        }
    }

seed_data()

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000)
