from functools import wraps
import hashlib
import html
import json
import math
import os
from pathlib import Path
import re
import secrets
from flask import Flask, render_template, request, jsonify, redirect, url_for, session, g
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename
from db import (
    create_block,
    create_level,
    create_lesson,
    create_module,
    create_user,
    delete_block,
    delete_level,
    delete_lesson,
    delete_module,
    get_all_blocks,
    get_block,
    get_default_user_id,
    get_level,
    get_lesson,
    create_lab_project,
    get_lab_project,
    get_lab_projects,
    get_module_with_lessons,
    get_modules_with_lessons,
    get_recent_submissions,
    get_user,
    get_user_by_email,
    init_db,
    save_answer_submission,
    update_lab_project_code,
    update_block,
)

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "dev-secret-key-change-me")
init_db()

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "static" / "uploads"
ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}

DEFAULT_TASK_TEXT = """
Решите линейное уравнение 2x + 5 = 17.
Запишите ответ числом.
""".strip()

DEFAULT_STARTER_CODE = ""


def google_slides_embed_url(url):
    if not url:
        return ""
    url = url.strip()
    iframe_src = re.search(r"""src=["']([^"']+)["']""", url)
    if iframe_src:
        url = iframe_src.group(1)
    url = html.unescape(url)
    if re.search(r"/presentation/d/e/(pubembed|embed)(\?|$)", url):
        return ""
    if "docs.google.com/presentation" in url and ("pubembed" in url or "/embed" in url):
        return url
    match = re.search(r"/presentation/d/e/([a-zA-Z0-9_-]+)", url)
    if match:
        return f"https://docs.google.com/presentation/d/e/{match.group(1)}/pubembed?start=false&loop=false&delayms=60000"
    match = re.search(r"/presentation/d/([a-zA-Z0-9_-]+)", url)
    if match:
        return f"https://docs.google.com/presentation/d/{match.group(1)}/embed?start=false&loop=false&delayms=3000"
    return url


app.jinja_env.filters["slides_embed"] = google_slides_embed_url


@app.before_request
def load_logged_in_user():
    user_id = session.get("user_id")
    g.user = get_user(user_id) if user_id else None


@app.context_processor
def inject_user():
    return {"current_user": g.get("user")}


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if not g.user:
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped_view


def admin_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if not g.user:
            return redirect(url_for("login", next=request.path))
        if g.user["role"] != "admin":
            return redirect(url_for("student_dashboard"))
        return view(*args, **kwargs)
    return wrapped_view


def current_user_id():
    if g.user:
        return g.user["id"]
    return get_default_user_id()


def allowed_image_file(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_IMAGE_EXTENSIONS
    )


def normalize_math_answer(value):
    return (
        str(value or "")
        .strip()
        .lower()
        .replace(",", ".")
        .replace(" ", "")
        .replace("−", "-")
        .removeprefix("x=")
        .removeprefix("+")
    )


def normalize_expression(value):
    expr = str(value or "").strip().lower()
    expr = expr.replace(",", ".").replace("−", "-").replace("^", "**")
    expr = re.sub(r"\s+", "", expr)
    expr = re.sub(r"(?<=\d)(?=x)", "*", expr)
    expr = re.sub(r"(?<=x)(?=\d)", "*", expr)
    expr = re.sub(r"(?<=\))(?=(x|\d|\())", "*", expr)
    expr = re.sub(r"(?<=(x|\d))(?=\()", "*", expr)
    return expr


def safe_eval_expression(expr, x_value):
    expr = normalize_expression(expr)
    replacements = {
        "sin": "math.sin",
        "cos": "math.cos",
        "tan": "math.tan",
        "sqrt": "math.sqrt",
        "abs": "abs",
        "log": "math.log",
        "exp": "math.exp",
        "pi": "math.pi",
        "e": "math.e",
    }
    for name, replacement in replacements.items():
        expr = re.sub(rf"\b{name}\b", replacement, expr)
    allowed = {"x": x_value, "math": math, "abs": abs}
    if not re.fullmatch(r"[0-9x+\-*/(). mathsincoqrtablgpe]+", expr):
        raise ValueError("unsupported expression")
    return float(eval(expr, {"__builtins__": {}}, allowed))


def split_equation_or_expression(value):
    expr = normalize_expression(value)
    if "=" in expr:
        left, right = expr.split("=", 1)
        return left, right
    return expr, "0"


def math_equivalent(user_value, expected_value):
    user_norm = normalize_math_answer(user_value)
    expected_norm = normalize_math_answer(expected_value)
    if user_norm == expected_norm:
        return True

    try:
        user_left, user_right = split_equation_or_expression(user_value)
        expected_left, expected_right = split_equation_or_expression(expected_value)
        samples = [-3, -1, 0, 2, 5]
        user_has_equation = "=" in str(user_value)
        expected_has_equation = "=" in str(expected_value)
        ratio = None
        for sample in samples:
            user_delta = safe_eval_expression(user_left, sample) - safe_eval_expression(user_right, sample)
            expected_delta = safe_eval_expression(expected_left, sample) - safe_eval_expression(expected_right, sample)
            if user_has_equation and expected_has_equation:
                if abs(expected_delta) < 1e-9:
                    if abs(user_delta) > 1e-7:
                        return False
                    continue
                current_ratio = user_delta / expected_delta
                if ratio is None:
                    ratio = current_ratio
                elif abs(current_ratio - ratio) > 1e-7:
                    return False
            elif abs(user_delta - expected_delta) > 1e-7:
                return False
        return True
    except Exception:
        return False


def formulas_equivalent(user_formula, expected_formula):
    try:
        samples = [-5, -4, -2, -0.5, 0.5, 1, 2, 3, 5]
        valid_samples = 0
        for sample in samples:
            try:
                user_value = safe_eval_expression(str(user_formula).removeprefix("y="), sample)
                expected_value = safe_eval_expression(str(expected_formula).removeprefix("y="), sample)
            except Exception:
                continue
            if abs(user_value - expected_value) > 1e-7:
                return False
            valid_samples += 1
        return valid_samples >= 3
    except Exception:
        return False


@app.after_request
def apply_headers(response):
    if getattr(g, "needs_cross_origin_isolation", False):
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
    return response

@app.route("/")
def index():
    if g.user:
        return redirect(url_for("student_dashboard"))
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        user = get_user_by_email(email)
        if not user or not user.get("password_hash") or not check_password_hash(user["password_hash"], password):
            error = "Неверная почта или пароль"
        else:
            session.clear()
            session["user_id"] = user["id"]
            next_url = request.args.get("next")
            if next_url:
                return redirect(next_url)
            return redirect(url_for("student_dashboard"))
    return render_template("auth/login.html", error=error)


@app.route("/register", methods=["GET", "POST"])
def register():
    error = None
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        if not name or not email or not password:
            error = "Заполни все поля"
        elif get_user_by_email(email):
            error = "Пользователь с такой почтой уже есть"
        else:
            user_id = create_user(name, email, generate_password_hash(password), "student")
            session.clear()
            session["user_id"] = user_id
            return redirect(url_for("student_dashboard"))
    return render_template("auth/register.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/student")
@login_required
def student_dashboard():
    modules = get_modules_with_lessons(current_user_id())
    return render_template("dashboard.html", modules=modules)


@app.route("/course")
@login_required
def course_page():
    modules = get_modules_with_lessons(current_user_id())
    if modules:
        return redirect(url_for("module_page", module_id=modules[0]["id"]))
    return render_template("dashboard.html", modules=modules)


@app.route("/laboratory")
@login_required
def laboratory_page():
    projects = get_lab_projects(current_user_id())
    return render_template("laboratory.html", projects=projects)


@app.route("/laboratory/projects/new", methods=["GET", "POST"])
@login_required
def new_lab_project():
    error = None
    if request.method == "POST":
        title = request.form.get("title", "").strip()
        goal = request.form.get("goal", "").strip()
        description = request.form.get("description", "").strip()
        if not title or not goal:
            error = "Название и цель проекта обязательны."
        else:
            project_id = create_lab_project(current_user_id(), title, goal, description)
            return redirect(url_for("lab_project_page", project_id=project_id, created=1))
    return render_template("lab_project_form.html", error=error)


@app.route("/laboratory/projects/<int:project_id>")
@login_required
def lab_project_page(project_id):
    project = get_lab_project(project_id, current_user_id())
    if not project:
        return redirect(url_for("laboratory_page"))
    return render_template(
        "lab_project.html",
        project=project,
        lab_created=request.args.get("created") == "1",
    )


@app.route("/api/laboratory/projects/<int:project_id>/code", methods=["POST"])
@login_required
def save_lab_project_code(project_id):
    data = request.get_json() or {}
    code = data.get("code", "")
    if not update_lab_project_code(project_id, current_user_id(), code):
        return jsonify({"error": "Проект не найден"}), 404
    return jsonify({"ok": True})


@app.route("/module/<int:module_id>")
@login_required
def module_page(module_id):
    module = get_module_with_lessons(module_id, current_user_id())
    if not module:
        return redirect(url_for("student_dashboard"))
    modules = get_modules_with_lessons(current_user_id())
    return render_template("module.html", module=module, modules=modules)


@app.route("/lesson/<int:lesson_id>")
@login_required
def lesson_page(lesson_id):
    lesson = get_lesson(lesson_id, current_user_id())
    if not lesson:
        return redirect(url_for("student_dashboard"))
    requested_block_id = request.args.get("block", type=int)
    active_block = None
    if lesson["blocks"]:
        active_block = next(
            (block for block in lesson["blocks"] if block["id"] == requested_block_id),
            lesson["blocks"][0],
        )
    active_index = lesson["blocks"].index(active_block) if active_block else -1
    next_block = lesson["blocks"][active_index + 1] if 0 <= active_index < len(lesson["blocks"]) - 1 else None
    prev_block = lesson["blocks"][active_index - 1] if active_index > 0 else None
    return render_template(
        "lesson.html",
        lesson=lesson,
        active_block=active_block,
        next_block=next_block,
        prev_block=prev_block,
    )


@app.route("/level/<int:level_id>")
@login_required
def level_page(level_id):
    level = get_level(level_id, current_user_id())
    if not level:
        return redirect(url_for("student_dashboard"))

    requested_block_id = request.args.get("block", type=int)
    active_block = None
    if level["blocks"]:
        active_block = next(
            (block for block in level["blocks"] if block["id"] == requested_block_id),
            level["blocks"][0],
        )
    active_index = level["blocks"].index(active_block) if active_block else -1
    next_block = level["blocks"][active_index + 1] if 0 <= active_index < len(level["blocks"]) - 1 else None

    return render_template(
        "level.html",
        level=level,
        active_block=active_block,
        next_block=next_block,
    )


@app.route("/block/<int:block_id>")
@login_required
def block_page(block_id):
    block = get_block(block_id)
    if not block:
        return redirect(url_for("student_dashboard"))

    if block.get("level_id"):
        return redirect(url_for("level_page", level_id=block["level_id"], block=block["id"]))

    return render_template("block.html", block=block)


@app.route("/admin")
@admin_required
def admin_dashboard():
    modules = get_modules_with_lessons(current_user_id())
    return render_template("admin/dashboard.html", modules=modules)


@app.route("/admin/module/<int:module_id>")
@admin_required
def admin_module_page(module_id):
    module = get_module_with_lessons(module_id, current_user_id())
    if not module:
        return redirect(url_for("admin_dashboard"))
    modules = get_modules_with_lessons(current_user_id())
    return render_template("admin/module.html", module=module, modules=modules)


@app.route("/admin/modules/new", methods=["GET", "POST"])
@admin_required
def admin_new_module():
    if request.method == "POST":
        create_module(
            request.form.get("title", "").strip(),
            request.form.get("description", "").strip(),
        )
        return redirect(url_for("admin_dashboard"))
    return render_template("admin/module_form.html")


@app.route("/admin/modules/<int:module_id>/delete", methods=["POST"])
@admin_required
def admin_delete_module(module_id):
    delete_module(module_id)
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/lessons/new", methods=["GET", "POST"])
@admin_required
def admin_new_lesson():
    modules = get_modules_with_lessons(current_user_id())
    if request.method == "POST":
        create_lesson(
            int(request.form.get("module_id")),
            request.form.get("title", "").strip(),
            request.form.get("description", "").strip(),
        )
        return redirect(url_for("admin_dashboard"))
    return render_template("admin/lesson_form.html", modules=modules)


@app.route("/admin/lessons/<int:lesson_id>/delete", methods=["POST"])
@admin_required
def admin_delete_lesson(lesson_id):
    lesson = get_lesson(lesson_id)
    module_id = lesson["module_id"] if lesson else None
    delete_lesson(lesson_id)
    if module_id:
        return redirect(url_for("admin_module_page", module_id=module_id))
    return redirect(url_for("admin_dashboard"))


def get_modules_with_levels_for_admin():
    modules = get_modules_with_lessons(current_user_id())
    return [
        get_module_with_lessons(module["id"], current_user_id())
        for module in modules
    ]


@app.route("/admin/levels/new", methods=["GET", "POST"])
@admin_required
def admin_new_level():
    modules = get_modules_with_levels_for_admin()
    lesson_id = request.args.get("lesson_id", type=int)
    if request.method == "POST":
        create_level(
            int(request.form.get("lesson_id")),
            request.form.get("title", "").strip(),
            request.form.get("description", "").strip(),
        )
        return redirect(url_for("admin_dashboard"))
    return render_template("admin/level_form.html", modules=modules, lesson_id=lesson_id)


@app.route("/admin/levels/<int:level_id>/delete", methods=["POST"])
@admin_required
def admin_delete_level(level_id):
    level = get_level(level_id, current_user_id())
    module_id = level["module"]["id"] if level and level.get("module") else None
    delete_level(level_id)
    if module_id:
        return redirect(url_for("admin_module_page", module_id=module_id))
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/blocks/new", methods=["GET", "POST"])
@admin_required
def admin_new_block():
    modules = get_modules_with_levels_for_admin()
    level_id = request.args.get("level_id", type=int)
    if request.method == "POST":
        data = parse_admin_block_data(request.form)
        posted_level_id = request.form.get("level_id", type=int)
        level = get_level(posted_level_id, current_user_id()) if posted_level_id else None
        create_block(
            level["lesson_id"] if level else int(request.form.get("lesson_id")),
            request.form.get("type", "theory"),
            request.form.get("title", "").strip(),
            request.form.get("content", "").strip(),
            data,
            posted_level_id,
        )
        return redirect(url_for("admin_dashboard"))
    return render_template("admin/block_form.html", modules=modules, block=None, level_id=level_id)


@app.route("/admin/blocks/<int:block_id>/edit", methods=["GET", "POST"])
@admin_required
def admin_edit_block(block_id):
    block = get_block(block_id)
    if not block:
        return redirect(url_for("admin_dashboard"))

    modules = get_modules_with_levels_for_admin()
    if request.method == "POST":
        data = parse_admin_block_data(request.form)
        update_block(
            block_id,
            request.form.get("type", "theory"),
            request.form.get("title", "").strip(),
            request.form.get("content", "").strip(),
            data,
        )
        return redirect(url_for("admin_dashboard"))
    return render_template("admin/block_form.html", modules=modules, block=block)


@app.route("/admin/blocks/<int:block_id>/delete", methods=["POST"])
@admin_required
def admin_delete_block(block_id):
    block = get_block(block_id)
    level_id = block["level_id"] if block else None
    delete_block(block_id)
    if level_id:
        return redirect(url_for("level_page", level_id=level_id))
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/uploads/image", methods=["POST"])
@admin_required
def admin_upload_image():
    image = request.files.get("image")
    if not image or not image.filename:
        return jsonify({"error": "Файл не передан"}), 400

    if not allowed_image_file(image.filename):
        return jsonify({"error": "Поддерживаются только png, jpg, jpeg, gif, webp"}), 400

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    original_name = secure_filename(image.filename)
    suffix = original_name.rsplit(".", 1)[1].lower()
    stem = original_name.rsplit(".", 1)[0][:48] or "image"
    filename = f"{stem}-{secrets.token_hex(6)}.{suffix}"
    path = UPLOAD_DIR / filename
    image.save(path)

    image_url = url_for("static", filename=f"uploads/{filename}")
    alt = request.form.get("alt", "").strip() or stem.replace("-", " ").replace("_", " ")
    return jsonify({
        "url": image_url,
        "markdown": f"![{alt}]({image_url})",
    })


def parse_admin_block_data(form):
    block_type = form.get("type", "theory")
    if block_type == "presentation":
        return {
            "embed_url": google_slides_embed_url(form.get("embed_url", "")),
        }
    if block_type in ("single_choice", "multiple_choice"):
        options = []
        option_texts = form.getlist("option_text")
        for index, text in enumerate(option_texts):
            text = text.strip()
            if not text:
                continue
            option_id = chr(97 + index)
            options.append({"id": option_id, "text": text})

        correct_ids = sorted(form.getlist("correct_option"))
        salt = form.get("salt", "").strip() or secrets.token_hex(8)
        answer_value = ",".join(correct_ids) if block_type == "multiple_choice" else (correct_ids[0] if correct_ids else "")
        answer_hash = hashlib.sha256(f"{salt}:{answer_value}".encode("utf-8")).hexdigest()
        return {
            "options": options,
            "correct_ids": correct_ids,
            "salt": salt,
            "answer_hash": answer_hash,
            "max_attempts": int(form.get("max_attempts") or 3),
        }
    if block_type == "matching":
        pairs = []
        left_values = form.getlist("match_left")
        right_values = form.getlist("match_right")
        for left, right in zip(left_values, right_values):
            left = left.strip()
            right = right.strip()
            if left and right:
                pairs.append({"left": left, "right": right})
        salt = form.get("salt", "").strip() or secrets.token_hex(8)
        answer_value = "|".join(
            f"{pair['left']}=>{pair['right']}"
            for pair in sorted(pairs, key=lambda item: item["left"])
        )
        answer_hash = hashlib.sha256(f"{salt}:{answer_value}".encode("utf-8")).hexdigest()
        return {
            "pairs": pairs,
            "salt": salt,
            "answer_hash": answer_hash,
            "max_attempts": int(form.get("max_attempts") or 3),
        }
    if block_type == "math_answer":
        salt = form.get("salt", "").strip() or secrets.token_hex(8)
        correct_answer = form.get("correct_answer", "")
        normalized_answer = normalize_math_answer(correct_answer)
        answer_hash = hashlib.sha256(f"{salt}:{normalized_answer}".encode("utf-8")).hexdigest()
        return {
            "correct_answer": correct_answer.strip(),
            "salt": salt,
            "answer_hash": answer_hash,
            "max_attempts": int(form.get("max_attempts") or 3),
            "hint": form.get("answer_hint", "").strip(),
            "placeholder": form.get("answer_placeholder", "").strip(),
        }
    if block_type == "graph_plotter":
        return {
            "default_formula": form.get("default_formula", "x^2").strip() or "x^2",
            "correct_formula": form.get("correct_formula", "").strip(),
        }
    if block_type == "step_solution":
        salt = form.get("salt", "").strip() or secrets.token_hex(8)
        labels = form.getlist("step_label")
        descriptions = form.getlist("step_description")
        placeholders = form.getlist("step_placeholder")
        answers = form.getlist("step_answer")
        steps = []
        for index, answer in enumerate(answers):
            answer = answer.strip()
            label = labels[index].strip() if index < len(labels) else ""
            description = descriptions[index].strip() if index < len(descriptions) else ""
            placeholder = placeholders[index].strip() if index < len(placeholders) else ""
            if not answer and not label and not description:
                continue
            normalized_answer = normalize_math_answer(answer)
            steps.append({
                "label": label,
                "description": description,
                "placeholder": placeholder,
                "answer": answer,
                "answer_hash": hashlib.sha256(f"{salt}:{index}:{normalized_answer}".encode("utf-8")).hexdigest(),
            })
        return {
            "salt": salt,
            "steps": steps,
            "max_attempts": int(form.get("max_attempts") or 3),
        }
    if block_type == "geometry_task":
        salt = form.get("salt", "").strip() or secrets.token_hex(8)
        correct_answer = form.get("geometry_answer", "")
        normalized_answer = normalize_math_answer(correct_answer)
        params = {
            "a": form.get("geometry_param_a", "").strip(),
            "b": form.get("geometry_param_b", "").strip(),
        }
        shapes = []
        raw_shapes = form.get("geometry_shapes_json", "").strip()
        if raw_shapes:
            try:
                parsed_shapes = json.loads(raw_shapes)
                if isinstance(parsed_shapes, list):
                    shapes = parsed_shapes
            except json.JSONDecodeError:
                shapes = []
        return {
            "shape": form.get("geometry_shape", "rectangle"),
            "params": params,
            "shapes": shapes,
            "answer_label": form.get("geometry_answer_label", "").strip(),
            "correct_answer": correct_answer.strip(),
            "placeholder": form.get("geometry_placeholder", "").strip(),
            "salt": salt,
            "answer_hash": hashlib.sha256(f"{salt}:{normalized_answer}".encode("utf-8")).hexdigest(),
            "max_attempts": int(form.get("max_attempts") or 3),
        }

    raw_json = form.get("data_json", "").strip()
    if raw_json:
        try:
            return json.loads(raw_json)
        except json.JSONDecodeError:
            pass
    return {}


@app.route("/api/local-check", methods=["POST"])
def local_check():
    data = request.get_json()
    block_id = data.get("block_id")
    answer = data.get("answer")
    solved = bool(data.get("solved"))
    feedback = data.get("feedback", "")

    if not block_id:
        return jsonify({"error": "block_id не передан"}), 400

    user_id = current_user_id()
    if user_id:
        save_answer_submission(user_id, int(block_id), answer, solved, feedback)
    return jsonify({"ok": True})


@app.route("/api/step-solution-check", methods=["POST"])
@login_required
def step_solution_check():
    data = request.get_json() or {}
    block_id = data.get("block_id")
    answers = data.get("answers") or []
    block = get_block(block_id) if block_id else None
    if not block or block["type"] != "step_solution":
        return jsonify({"error": "Блок пошагового решения не найден"}), 404

    steps = block["data"].get("steps", [])
    results = []
    correct_count = 0
    for index, step in enumerate(steps):
        user_answer = answers[index] if index < len(answers) else ""
        is_correct = math_equivalent(user_answer, step.get("answer", ""))
        results.append({"index": index, "correct": is_correct})
        if is_correct:
            correct_count += 1

    solved = bool(steps) and correct_count == len(steps)
    message = (
        "Верно. Все шаги решения заполнены правильно."
        if solved
        else f"Верных шагов: {correct_count}/{len(steps)}."
    )
    save_answer_submission(current_user_id(), int(block_id), answers, solved, message)
    return jsonify({
        "solved": solved,
        "results": results,
        "correct_count": correct_count,
        "total": len(steps),
        "message": message,
    })


@app.route("/api/graph-formula-check", methods=["POST"])
@login_required
def graph_formula_check():
    data = request.get_json() or {}
    block_id = data.get("block_id")
    formula = data.get("formula", "")
    block = get_block(block_id) if block_id else None
    if not block or block["type"] != "graph_plotter":
        return jsonify({"error": "Блок графика не найден"}), 404

    expected_formula = block["data"].get("correct_formula", "").strip()
    if not expected_formula:
        return jsonify({
            "solved": False,
            "message": "Для этого графика админ не задал формулу для проверки.",
        }), 400

    solved = formulas_equivalent(formula, expected_formula)
    message = "Верно. Формула задает нужный график." if solved else "Пока формула не совпадает с ожидаемым графиком."
    save_answer_submission(current_user_id(), int(block_id), formula, solved, message)
    return jsonify({"solved": solved, "message": message})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
