import json
import hashlib
import sqlite3
from pathlib import Path
from werkzeug.security import generate_password_hash


BASE_DIR = Path(__file__).resolve().parent
INSTANCE_DIR = BASE_DIR / "instance"
DB_PATH = INSTANCE_DIR / "app.db"


def get_connection():
    INSTANCE_DIR.mkdir(exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db():
    with get_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE,
                password_hash TEXT,
                role TEXT NOT NULL DEFAULT 'student',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS modules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                module_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS lesson_levels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS lesson_blocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_id INTEGER NOT NULL,
                level_id INTEGER,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                data_json TEXT NOT NULL DEFAULT '{}',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
                FOREIGN KEY (level_id) REFERENCES lesson_levels(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                lesson_id INTEGER NOT NULL,
                block_id INTEGER,
                status TEXT NOT NULL DEFAULT 'not_started',
                attempts_count INTEGER NOT NULL DEFAULT 0,
                score INTEGER NOT NULL DEFAULT 0,
                completed_at TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
                FOREIGN KEY (block_id) REFERENCES lesson_blocks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                block_id INTEGER NOT NULL,
                answer_json TEXT NOT NULL DEFAULT '{}',
                code TEXT NOT NULL DEFAULT '',
                is_correct INTEGER NOT NULL DEFAULT 0,
                feedback TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (block_id) REFERENCES lesson_blocks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                block_id INTEGER,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (block_id) REFERENCES lesson_blocks(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS student_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                module_id INTEGER,
                note_type TEXT NOT NULL,
                summary TEXT NOT NULL,
                severity TEXT NOT NULL DEFAULT 'info',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS lab_projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                goal TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                code TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )
    migrate_seed_data()
    seed_database()


def migrate_seed_data():
    choice_salt = "seed-single-choice-1"
    choice_hash = hashlib.sha256(f"{choice_salt}:b".encode("utf-8")).hexdigest()
    with get_connection() as connection:
        columns = [
            row["name"]
            for row in connection.execute("PRAGMA table_info(users)").fetchall()
        ]
        if "password_hash" not in columns:
            connection.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")

        connection.execute(
            """
            UPDATE users
            SET password_hash = ?
            WHERE email = ? AND (password_hash IS NULL OR password_hash = '')
            """,
            (generate_password_hash("student123"), "student@example.com"),
        )
        admin = connection.execute(
            "SELECT id FROM users WHERE email = ?",
            ("admin@example.com",),
        ).fetchone()
        if not admin:
            connection.execute(
                """
                INSERT INTO users (name, email, password_hash, role)
                VALUES (?, ?, ?, ?)
                """,
                (
                    "Администратор",
                    "admin@example.com",
                    generate_password_hash("admin123"),
                    "admin",
                ),
            )

        block_columns = [
            row["name"]
            for row in connection.execute("PRAGMA table_info(lesson_blocks)").fetchall()
        ]
        if "level_id" not in block_columns:
            connection.execute("ALTER TABLE lesson_blocks ADD COLUMN level_id INTEGER")

        lessons = connection.execute("SELECT id FROM lessons").fetchall()
        for lesson in lessons:
            level = connection.execute(
                "SELECT id FROM lesson_levels WHERE lesson_id = ? ORDER BY sort_order, id LIMIT 1",
                (lesson["id"],),
            ).fetchone()
            if level:
                level_id = level["id"]
            else:
                cursor = connection.execute(
                    """
                    INSERT INTO lesson_levels (lesson_id, title, description, sort_order)
                    VALUES (?, ?, ?, ?)
                    """,
                    (lesson["id"], "Основной уровень", "Первый набор заданий урока.", 1),
                )
                level_id = cursor.lastrowid
            connection.execute(
                "UPDATE lesson_blocks SET level_id = ? WHERE lesson_id = ? AND level_id IS NULL",
                (level_id, lesson["id"]),
            )

        rows = connection.execute(
            """
            SELECT id, data_json
            FROM lesson_blocks
            WHERE type = 'single_choice'
            """
        ).fetchall()
        for row in rows:
            data = json.loads(row["data_json"] or "{}")
            if data.get("answer_hash") == "placeholder-local-hash" or "salt" not in data:
                data["salt"] = choice_salt
                data["answer_hash"] = choice_hash
                data["correct_ids"] = ["b"]
                connection.execute(
                    "UPDATE lesson_blocks SET data_json = ? WHERE id = ?",
                    (json.dumps(data), row["id"]),
                )

        presentation_rows = connection.execute(
            """
            SELECT id, data_json
            FROM lesson_blocks
            WHERE type = 'presentation'
            """
        ).fetchall()
        fallback_url = None
        for row in presentation_rows:
            data = json.loads(row["data_json"] or "{}")
            embed_url = data.get("embed_url", "")
            if "docs.google.com/presentation/d/e/" in embed_url and "pubembed" in embed_url:
                fallback_url = embed_url
                break
        for row in presentation_rows:
            data = json.loads(row["data_json"] or "{}")
            embed_url = data.get("embed_url", "")
            if "/presentation/d/e/embed" in embed_url:
                data["embed_url"] = fallback_url or ""
                connection.execute(
                    "UPDATE lesson_blocks SET data_json = ? WHERE id = ?",
                    (json.dumps(data), row["id"]),
                )


def seed_database():
    def answer_hash(salt, answer):
        return hashlib.sha256(f"{salt}:{answer}".encode("utf-8")).hexdigest()

    def normalize_math_answer(value):
        return (
            str(value or "")
            .strip()
            .lower()
            .replace(",", ".")
            .replace(" ", "")
            .removeprefix("x=")
            .removeprefix("+")
        )

    def matching_answer(pairs):
        return "|".join(
            f"{pair['left']}=>{pair['right']}"
            for pair in sorted(pairs, key=lambda item: item["left"])
        )

    with get_connection() as connection:
        modules_count = connection.execute("SELECT COUNT(*) FROM modules").fetchone()[0]
        if modules_count:
            return

        cursor = connection.execute(
            "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
            (
                "Тестовый ученик",
                "student@example.com",
                generate_password_hash("student123"),
                "student",
            ),
        )
        user_id = cursor.lastrowid

        course = [
            {
                "title": "Алгебра: старт",
                "description": "Числа, выражения, уравнения и первые уверенные решения.",
                "lessons": [
                    {
                        "title": "Линейные уравнения",
                        "description": "Учимся переносить слагаемые и находить неизвестное.",
                        "levels": [
                            {
                                "title": "Понять идею",
                                "description": "Разбираем уравнение как равновесие двух частей.",
                                "blocks": [
                                    {
                                        "type": "theory",
                                        "title": "Что такое линейное уравнение",
                                        "content": "Линейное уравнение с одной переменной можно привести к виду `ax + b = c`. Цель - оставить переменную отдельно, выполняя одинаковые действия с обеими частями.\n\nПример: `2x + 5 = 17`.\n\n1. Вычтем 5 из обеих частей: `2x = 12`.\n2. Разделим обе части на 2: `x = 6`.\n\nГлавное правило: если меняешь левую часть, то тем же действием меняй правую.",
                                        "data": {
                                            "images": [],
                                        },
                                    },
                                    {
                                        "type": "single_choice",
                                        "title": "Первый шаг решения",
                                        "content": "Какой первый шаг удобнее сделать в уравнении `3x + 7 = 22`?",
                                        "data": {
                                            "options": [
                                                {"id": "a", "text": "Разделить обе части на 7"},
                                                {"id": "b", "text": "Вычесть 7 из обеих частей"},
                                                {"id": "c", "text": "Прибавить 22 к обеим частям"},
                                            ],
                                            "salt": "linear-step-1",
                                            "answer_hash": answer_hash("linear-step-1", "b"),
                                            "max_attempts": 3,
                                        },
                                    },
                                    {
                                        "type": "math_answer",
                                        "title": "Реши уравнение",
                                        "content": "Реши уравнение `2x + 5 = 17` и введи значение `x`.",
                                        "data": {
                                            "correct_answer": "6",
                                            "salt": "linear-answer-1",
                                            "answer_hash": answer_hash("linear-answer-1", normalize_math_answer("6")),
                                            "max_attempts": 3,
                                            "hint": "Можно ввести только число.",
                                            "placeholder": "Например: 6",
                                        },
                                    },
                                    {
                                        "type": "step_solution",
                                        "title": "Решение по шагам",
                                        "content": "Реши уравнение `3x - 4 = 11`. Заполни преобразования в правильном порядке.",
                                        "data": {
                                            "salt": "step-linear-1",
                                            "max_attempts": 3,
                                            "steps": [
                                                {
                                                    "label": "Перенеси -4 в правую часть",
                                                    "description": "Прибавь 4 к обеим частям уравнения.",
                                                    "placeholder": "Например: 3x = 15",
                                                    "answer": "3x=15",
                                                    "answer_hash": answer_hash("step-linear-1:0", normalize_math_answer("3x=15")),
                                                },
                                                {
                                                    "label": "Раздели обе части на 3",
                                                    "description": "Оставь x отдельно.",
                                                    "placeholder": "Например: x = 5",
                                                    "answer": "x=5",
                                                    "answer_hash": answer_hash("step-linear-1:1", normalize_math_answer("x=5")),
                                                },
                                                {
                                                    "label": "Запиши ответ",
                                                    "description": "",
                                                    "placeholder": "Например: 5",
                                                    "answer": "5",
                                                    "answer_hash": answer_hash("step-linear-1:2", normalize_math_answer("5")),
                                                },
                                            ],
                                        },
                                    },
                                ],
                            },
                            {
                                "title": "Закрепить",
                                "description": "Проверяем, что шаги решения стали понятными.",
                                "blocks": [
                                    {
                                        "type": "matching",
                                        "title": "Сопоставь действие и результат",
                                        "content": "Соедини уравнение с результатом после правильного первого действия.",
                                        "data": {
                                            "pairs": [
                                                {"left": "x + 9 = 14", "right": "x = 5"},
                                                {"left": "4x = 28", "right": "x = 7"},
                                                {"left": "2x + 3 = 11", "right": "2x = 8"},
                                            ],
                                            "salt": "linear-matching-1",
                                            "answer_hash": answer_hash(
                                                "linear-matching-1",
                                                matching_answer([
                                                    {"left": "x + 9 = 14", "right": "x = 5"},
                                                    {"left": "4x = 28", "right": "x = 7"},
                                                    {"left": "2x + 3 = 11", "right": "2x = 8"},
                                                ]),
                                            ),
                                            "max_attempts": 3,
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        "title": "Проценты",
                        "description": "Переводим проценты в дроби и решаем бытовые задачи.",
                        "levels": [
                            {
                                "title": "База",
                                "description": "Процент как сотая часть числа.",
                                "blocks": [
                                    {
                                        "type": "theory",
                                        "title": "Процент - это одна сотая",
                                        "content": "`1%` означает одну сотую часть. Поэтому `25% = 25/100 = 0.25`.\n\nЧтобы найти 20% от 300, можно умножить `300 * 0.20 = 60`.\n\nЧтобы увеличить число на 15%, умножают на `1.15`. Чтобы уменьшить на 15%, умножают на `0.85`.",
                                        "data": {
                                            "images": [],
                                        },
                                    },
                                    {
                                        "type": "single_choice",
                                        "title": "Найди процент",
                                        "content": "Сколько будет 15% от 200?",
                                        "data": {
                                            "options": [
                                                {"id": "a", "text": "15"},
                                                {"id": "b", "text": "30"},
                                                {"id": "c", "text": "45"},
                                            ],
                                            "salt": "percent-choice-1",
                                            "answer_hash": answer_hash("percent-choice-1", "b"),
                                            "max_attempts": 3,
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            {
                "title": "Геометрия",
                "description": "Фигуры, углы, площади и аккуратная работа с чертежом.",
                "lessons": [
                    {
                        "title": "Площадь прямоугольника",
                        "description": "Понимаем формулу площади и применяем ее в задачах.",
                        "levels": [
                            {
                                "title": "Формула",
                                "description": "Площадь как количество квадратных единиц внутри фигуры.",
                                "blocks": [
                                    {
                                        "type": "theory",
                                        "title": "Площадь прямоугольника",
                                        "content": "Площадь прямоугольника равна произведению его сторон: `S = a * b`.\n\nЕсли длина равна 8 см, а ширина 5 см, то площадь равна `8 * 5 = 40` квадратных сантиметров.",
                                        "data": {
                                            "images": [],
                                        },
                                    },
                                    {
                                        "type": "single_choice",
                                        "title": "Быстрая проверка",
                                        "content": "Чему равна площадь прямоугольника со сторонами 6 см и 9 см?",
                                        "data": {
                                            "options": [
                                                {"id": "a", "text": "15 см²"},
                                                {"id": "b", "text": "30 см²"},
                                                {"id": "c", "text": "54 см²"},
                                            ],
                                            "salt": "area-choice-1",
                                            "answer_hash": answer_hash("area-choice-1", "c"),
                                            "max_attempts": 3,
                                        },
                                    },
                                    {
                                        "type": "geometry_task",
                                        "title": "Площадь по чертежу",
                                        "content": "На рисунке прямоугольник со сторонами `6` и `9`. Найди его площадь.",
                                        "data": {
                                            "shape": "rectangle",
                                            "params": {"a": "6", "b": "9"},
                                            "answer_label": "Площадь",
                                            "correct_answer": "54",
                                            "placeholder": "Например: 54",
                                            "salt": "geometry-rectangle-1",
                                            "answer_hash": answer_hash("geometry-rectangle-1", normalize_math_answer("54")),
                                            "max_attempts": 3,
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            {
                "title": "Функции и графики",
                "description": "Координатная плоскость, линейная функция и чтение графиков.",
                "lessons": [
                    {
                        "title": "Линейная функция",
                        "description": "Разбираем вид `y = kx + b` и смысл коэффициентов.",
                        "levels": [
                            {
                                "title": "Коэффициенты",
                                "description": "Что меняют k и b на графике.",
                                "blocks": [
                                    {
                                        "type": "theory",
                                        "title": "Функция y = kx + b",
                                        "content": "В формуле `y = kx + b` коэффициент `k` отвечает за наклон прямой, а `b` показывает, где прямая пересекает ось `y`.\n\nЕсли `k > 0`, график идет вверх слева направо. Если `k < 0`, график идет вниз.",
                                        "data": {
                                            "images": [],
                                        },
                                    },
                                    {
                                        "type": "graph_plotter",
                                        "title": "Построй свой график",
                                        "content": "Введи формулу функции и посмотри, как меняется график. Начни с `2*x + 1`, затем попробуй `x^2 - 4`.",
                                        "data": {
                                            "default_formula": "2*x + 1",
                                            "correct_formula": "2*x + 1",
                                        },
                                    },
                                    {
                                        "type": "single_choice",
                                        "title": "Смысл b",
                                        "content": "Что показывает число `b` в формуле `y = kx + b`?",
                                        "data": {
                                            "options": [
                                                {"id": "a", "text": "Точку пересечения с осью y"},
                                                {"id": "b", "text": "Площадь под графиком"},
                                                {"id": "c", "text": "Количество решений уравнения"},
                                            ],
                                            "salt": "linear-function-choice-1",
                                            "answer_hash": answer_hash("linear-function-choice-1", "a"),
                                            "max_attempts": 3,
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ]

        for module_index, module in enumerate(course, start=1):
            cursor = connection.execute(
                """
                INSERT INTO modules (title, description, sort_order)
                VALUES (?, ?, ?)
                """,
                (module["title"], module["description"], module_index),
            )
            module_id = cursor.lastrowid

            for lesson_index, lesson in enumerate(module["lessons"], start=1):
                cursor = connection.execute(
                    """
                    INSERT INTO lessons (module_id, title, description, sort_order)
                    VALUES (?, ?, ?, ?)
                    """,
                    (module_id, lesson["title"], lesson["description"], lesson_index),
                )
                lesson_id = cursor.lastrowid

                for level_index, level in enumerate(lesson["levels"], start=1):
                    cursor = connection.execute(
                        """
                        INSERT INTO lesson_levels (lesson_id, title, description, sort_order)
                        VALUES (?, ?, ?, ?)
                        """,
                        (lesson_id, level["title"], level["description"], level_index),
                    )
                    level_id = cursor.lastrowid

                    for block_index, block in enumerate(level["blocks"], start=1):
                        connection.execute(
                            """
                            INSERT INTO lesson_blocks
                                (lesson_id, level_id, type, title, content, data_json, sort_order)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                lesson_id,
                                level_id,
                                block["type"],
                                block["title"],
                                block["content"],
                                json.dumps(block["data"]),
                                block_index,
                            ),
                        )

                connection.execute(
                    """
                    INSERT INTO progress (user_id, lesson_id, status)
                    VALUES (?, ?, ?)
                    """,
                    (user_id, lesson_id, "not_started"),
                )


def row_to_dict(row):
    if row is None:
        return None
    return dict(row)


def parse_block(row):
    block = row_to_dict(row)
    if not block:
        return None
    block["data"] = json.loads(block.pop("data_json") or "{}")
    return block


def create_lab_project(user_id, title, goal, description):
    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO lab_projects (user_id, title, goal, description, code)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                user_id,
                title,
                goal,
                description,
                "",
            ),
        )
        return cursor.lastrowid


def get_lab_projects(user_id):
    with get_connection() as connection:
        return [
            row_to_dict(row)
            for row in connection.execute(
                """
                SELECT *
                FROM lab_projects
                WHERE user_id = ?
                ORDER BY updated_at DESC, id DESC
                """,
                (user_id,),
            ).fetchall()
        ]


def get_lab_project(project_id, user_id):
    with get_connection() as connection:
        return row_to_dict(
            connection.execute(
                """
                SELECT *
                FROM lab_projects
                WHERE id = ? AND user_id = ?
                """,
                (project_id, user_id),
            ).fetchone()
        )


def update_lab_project_code(project_id, user_id, code):
    with get_connection() as connection:
        cursor = connection.execute(
            """
            UPDATE lab_projects
            SET code = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
            """,
            (code, project_id, user_id),
        )
        return cursor.rowcount > 0


def get_modules_with_lessons(user_id=None):
    with get_connection() as connection:
        modules = [
            row_to_dict(row)
            for row in connection.execute(
                "SELECT * FROM modules ORDER BY sort_order, id"
            ).fetchall()
        ]
        for module in modules:
            module["lessons"] = [
                row_to_dict(row)
                for row in connection.execute(
                    """
                    SELECT * FROM lessons
                    WHERE module_id = ?
                    ORDER BY sort_order, id
                    """,
                    (module["id"],),
                ).fetchall()
            ]
            for lesson in module["lessons"]:
                lesson["progress"] = get_lesson_progress_summary(connection, user_id, lesson["id"])
        return modules


def get_module_with_lessons(module_id, user_id=None):
    with get_connection() as connection:
        module = row_to_dict(
            connection.execute("SELECT * FROM modules WHERE id = ?", (module_id,)).fetchone()
        )
        if not module:
            return None
        module["lessons"] = [
            row_to_dict(row)
            for row in connection.execute(
                """
                SELECT * FROM lessons
                WHERE module_id = ?
                ORDER BY sort_order, id
                """,
                (module_id,),
            ).fetchall()
        ]
        for lesson in module["lessons"]:
            lesson["levels"] = get_lesson_levels(lesson["id"], user_id)
            lesson["progress"] = get_lesson_progress_summary(connection, user_id, lesson["id"])
        return module


def get_lesson_levels(lesson_id, user_id=None):
    with get_connection() as connection:
        levels = [
            row_to_dict(row)
            for row in connection.execute(
                """
                SELECT * FROM lesson_levels
                WHERE lesson_id = ?
                ORDER BY sort_order, id
                """,
                (lesson_id,),
            ).fetchall()
        ]
        for level in levels:
            level["blocks"] = get_level_blocks(level["id"], user_id)
            level["progress"] = get_level_progress_summary(connection, user_id, level["id"])
        return levels


def get_lesson(lesson_id, user_id=None):
    with get_connection() as connection:
        lesson = row_to_dict(
            connection.execute("SELECT * FROM lessons WHERE id = ?", (lesson_id,)).fetchone()
        )
        if not lesson:
            return None
        lesson["levels"] = get_lesson_levels(lesson_id, user_id)
        lesson["blocks"] = [
            parse_block(row)
            for row in connection.execute(
                """
                SELECT * FROM lesson_blocks
                WHERE lesson_id = ?
                ORDER BY sort_order, id
                """,
                (lesson_id,),
            ).fetchall()
        ]
        for block in lesson["blocks"]:
            block["progress"] = get_block_progress(connection, user_id, block["id"])
        lesson["progress"] = get_lesson_progress_summary(connection, user_id, lesson_id)
        return lesson


def get_level(level_id, user_id=None):
    with get_connection() as connection:
        level = row_to_dict(
            connection.execute("SELECT * FROM lesson_levels WHERE id = ?", (level_id,)).fetchone()
        )
        if not level:
            return None
        lesson = row_to_dict(
            connection.execute("SELECT * FROM lessons WHERE id = ?", (level["lesson_id"],)).fetchone()
        )
        module = row_to_dict(
            connection.execute("SELECT * FROM modules WHERE id = ?", (lesson["module_id"],)).fetchone()
        ) if lesson else None
        level["lesson"] = lesson
        level["module"] = module
        level["blocks"] = get_level_blocks(level_id, user_id)
        level["progress"] = get_level_progress_summary(connection, user_id, level_id)
        return level


def get_level_blocks(level_id, user_id=None):
    with get_connection() as connection:
        blocks = [
            parse_block(row)
            for row in connection.execute(
                """
                SELECT * FROM lesson_blocks
                WHERE level_id = ?
                ORDER BY sort_order, id
                """,
                (level_id,),
            ).fetchall()
        ]
        for block in blocks:
            block["progress"] = get_block_progress(connection, user_id, block["id"])
        return blocks


def get_level_progress_summary(connection, user_id, level_id):
    total = connection.execute(
        "SELECT COUNT(*) FROM lesson_blocks WHERE level_id = ?",
        (level_id,),
    ).fetchone()[0]
    if not user_id or total == 0:
        return {"completed": 0, "total": total, "percent": 0, "status": "not_started"}
    completed = connection.execute(
        """
        SELECT COUNT(DISTINCT progress.block_id)
        FROM progress
        JOIN lesson_blocks ON lesson_blocks.id = progress.block_id
        WHERE progress.user_id = ?
          AND lesson_blocks.level_id = ?
          AND progress.status = 'completed'
        """,
        (user_id, level_id),
    ).fetchone()[0]
    percent = round((completed / total) * 100)
    status = "completed" if completed == total else "in_progress" if completed else "not_started"
    return {"completed": completed, "total": total, "percent": percent, "status": status}


def get_block_progress(connection, user_id, block_id):
    if not user_id:
        return None
    row = connection.execute(
        """
        SELECT * FROM progress
        WHERE user_id = ? AND block_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
        """,
        (user_id, block_id),
    ).fetchone()
    return row_to_dict(row)


def get_lesson_progress_summary(connection, user_id, lesson_id):
    total = connection.execute(
        "SELECT COUNT(*) FROM lesson_blocks WHERE lesson_id = ?",
        (lesson_id,),
    ).fetchone()[0]
    if not user_id or total == 0:
        return {"completed": 0, "total": total, "percent": 0, "status": "not_started"}

    completed = connection.execute(
        """
        SELECT COUNT(DISTINCT block_id)
        FROM progress
        WHERE user_id = ? AND lesson_id = ? AND status = 'completed'
        """,
        (user_id, lesson_id),
    ).fetchone()[0]
    percent = round((completed / total) * 100)
    status = "completed" if completed == total else "in_progress" if completed else "not_started"
    return {"completed": completed, "total": total, "percent": percent, "status": status}


def get_block(block_id):
    with get_connection() as connection:
        return parse_block(
            connection.execute(
                "SELECT * FROM lesson_blocks WHERE id = ?",
                (block_id,),
            ).fetchone()
        )


def get_first_lesson_id():
    with get_connection() as connection:
        row = connection.execute(
            "SELECT id FROM lessons ORDER BY sort_order, id LIMIT 1"
        ).fetchone()
        return row["id"] if row else None


def get_module(module_id):
    with get_connection() as connection:
        return row_to_dict(
            connection.execute("SELECT * FROM modules WHERE id = ?", (module_id,)).fetchone()
        )


def get_all_blocks():
    with get_connection() as connection:
        return [
            parse_block(row)
            for row in connection.execute(
                """
                SELECT lesson_blocks.*, lessons.title AS lesson_title
                FROM lesson_blocks
                JOIN lessons ON lessons.id = lesson_blocks.lesson_id
                ORDER BY lessons.sort_order, lesson_blocks.sort_order, lesson_blocks.id
                """
            ).fetchall()
        ]


def create_module(title, description):
    with get_connection() as connection:
        sort_order = connection.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM modules").fetchone()[0]
        cursor = connection.execute(
            """
            INSERT INTO modules (title, description, sort_order)
            VALUES (?, ?, ?)
            """,
            (title, description, sort_order),
        )
        return cursor.lastrowid


def create_lesson(module_id, title, description):
    with get_connection() as connection:
        sort_order = connection.execute(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM lessons WHERE module_id = ?",
            (module_id,),
        ).fetchone()[0]
        cursor = connection.execute(
            """
            INSERT INTO lessons (module_id, title, description, sort_order)
            VALUES (?, ?, ?, ?)
            """,
            (module_id, title, description, sort_order),
        )
        return cursor.lastrowid


def create_level(lesson_id, title, description):
    with get_connection() as connection:
        sort_order = connection.execute(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM lesson_levels WHERE lesson_id = ?",
            (lesson_id,),
        ).fetchone()[0]
        cursor = connection.execute(
            """
            INSERT INTO lesson_levels (lesson_id, title, description, sort_order)
            VALUES (?, ?, ?, ?)
            """,
            (lesson_id, title, description, sort_order),
        )
        return cursor.lastrowid


def create_block(lesson_id, block_type, title, content, data, level_id=None):
    with get_connection() as connection:
        if level_id is None:
            row = connection.execute(
                "SELECT id FROM lesson_levels WHERE lesson_id = ? ORDER BY sort_order, id LIMIT 1",
                (lesson_id,),
            ).fetchone()
            level_id = row["id"] if row else create_level(lesson_id, "Основной уровень", "")
        sort_order = connection.execute(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM lesson_blocks WHERE level_id = ?",
            (level_id,),
        ).fetchone()[0]
        cursor = connection.execute(
            """
            INSERT INTO lesson_blocks
                (lesson_id, level_id, type, title, content, data_json, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (lesson_id, level_id, block_type, title, content, json.dumps(data), sort_order),
        )
        return cursor.lastrowid


def update_block(block_id, block_type, title, content, data):
    with get_connection() as connection:
        connection.execute(
            """
            UPDATE lesson_blocks
            SET type = ?, title = ?, content = ?, data_json = ?
            WHERE id = ?
            """,
            (block_type, title, content, json.dumps(data), block_id),
        )


def delete_module(module_id):
    with get_connection() as connection:
        connection.execute("DELETE FROM modules WHERE id = ?", (module_id,))


def delete_lesson(lesson_id):
    with get_connection() as connection:
        connection.execute("DELETE FROM lessons WHERE id = ?", (lesson_id,))


def delete_level(level_id):
    with get_connection() as connection:
        connection.execute("DELETE FROM lesson_levels WHERE id = ?", (level_id,))


def delete_block(block_id):
    with get_connection() as connection:
        connection.execute("DELETE FROM lesson_blocks WHERE id = ?", (block_id,))


def get_default_user_id():
    with get_connection() as connection:
        row = connection.execute("SELECT id FROM users ORDER BY id LIMIT 1").fetchone()
        return row["id"] if row else None


def get_user_by_email(email):
    with get_connection() as connection:
        return row_to_dict(
            connection.execute(
                "SELECT * FROM users WHERE email = ?",
                (email,),
            ).fetchone()
        )


def get_user(user_id):
    with get_connection() as connection:
        return row_to_dict(
            connection.execute(
                "SELECT * FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
        )


def create_user(name, email, password_hash, role="student"):
    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO users (name, email, password_hash, role)
            VALUES (?, ?, ?, ?)
            """,
            (name, email, password_hash, role),
        )
        return cursor.lastrowid


def save_submission(user_id, block_id, code, is_correct, feedback):
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO submissions (user_id, block_id, code, is_correct, feedback)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, block_id, code, 1 if is_correct else 0, feedback),
        )
        block = connection.execute(
            "SELECT lesson_id FROM lesson_blocks WHERE id = ?",
            (block_id,),
        ).fetchone()
        if not block:
            return

        existing = connection.execute(
            """
            SELECT id, attempts_count FROM progress
            WHERE user_id = ? AND lesson_id = ? AND block_id = ?
            """,
            (user_id, block["lesson_id"], block_id),
        ).fetchone()
        status = "completed" if is_correct else "in_progress"
        score = 100 if is_correct else 0

        if existing:
            connection.execute(
                """
                UPDATE progress
                SET status = ?,
                    attempts_count = ?,
                    score = ?,
                    completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE completed_at END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (status, existing["attempts_count"] + 1, score, 1 if is_correct else 0, existing["id"]),
            )
        else:
            connection.execute(
                """
                INSERT INTO progress
                    (user_id, lesson_id, block_id, status, attempts_count, score, completed_at)
                VALUES (?, ?, ?, ?, 1, ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END)
                """,
                (user_id, block["lesson_id"], block_id, status, score, 1 if is_correct else 0),
            )


def save_answer_submission(user_id, block_id, answer, is_correct, feedback):
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO submissions (user_id, block_id, answer_json, is_correct, feedback)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, block_id, json.dumps({"answer": answer}), 1 if is_correct else 0, feedback),
        )
        block = connection.execute(
            "SELECT lesson_id FROM lesson_blocks WHERE id = ?",
            (block_id,),
        ).fetchone()
        if not block:
            return

        existing = connection.execute(
            """
            SELECT id, attempts_count FROM progress
            WHERE user_id = ? AND lesson_id = ? AND block_id = ?
            """,
            (user_id, block["lesson_id"], block_id),
        ).fetchone()
        status = "completed" if is_correct else "in_progress"
        score = 100 if is_correct else 0
        if existing:
            connection.execute(
                """
                UPDATE progress
                SET status = ?,
                    attempts_count = ?,
                    score = ?,
                    completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE completed_at END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (status, existing["attempts_count"] + 1, score, 1 if is_correct else 0, existing["id"]),
            )
        else:
            connection.execute(
                """
                INSERT INTO progress
                    (user_id, lesson_id, block_id, status, attempts_count, score, completed_at)
                VALUES (?, ?, ?, ?, 1, ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END)
                """,
                (user_id, block["lesson_id"], block_id, status, score, 1 if is_correct else 0),
            )


def get_recent_submissions(limit=20):
    with get_connection() as connection:
        return [
            row_to_dict(row)
            for row in connection.execute(
                """
                SELECT submissions.*, users.name AS user_name, lesson_blocks.title AS block_title
                FROM submissions
                JOIN users ON users.id = submissions.user_id
                JOIN lesson_blocks ON lesson_blocks.id = submissions.block_id
                ORDER BY submissions.created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        ]
