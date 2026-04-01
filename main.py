import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

app = FastAPI(title="My Job App")

# ── Database ──────────────────────────────────────────────────────────────────

DB_PATH = "notes.db"


def init_db():
    with sqlite3.connect(DB_PATH) as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS notes (
                id        TEXT PRIMARY KEY,
                title     TEXT NOT NULL,
                content   TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)


@contextmanager
def get_db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


init_db()


# ── Models ────────────────────────────────────────────────────────────────────

class NoteSchema(BaseModel):
    title: str
    content: str = ""


# ── Note API ──────────────────────────────────────────────────────────────────

@app.get("/api/notes")
def list_notes():
    with get_db() as con:
        rows = con.execute(
            "SELECT * FROM notes ORDER BY updated_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/notes", status_code=201)
def create_note(note: NoteSchema):
    now = datetime.now().isoformat()
    note_id = str(uuid.uuid4())
    title = note.title.strip()
    with get_db() as con:
        con.execute(
            "INSERT INTO notes VALUES (?, ?, ?, ?, ?)",
            (note_id, title, note.content, now, now),
        )
    return {"id": note_id, "title": title, "content": note.content,
            "created_at": now, "updated_at": now}


@app.put("/api/notes/{note_id}")
def update_note(note_id: str, note: NoteSchema):
    now = datetime.now().isoformat()
    title = note.title.strip()
    with get_db() as con:
        cur = con.execute(
            "UPDATE notes SET title=?, content=?, updated_at=? WHERE id=?",
            (title, note.content, now, note_id),
        )
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="メモが見つかりません")
    return {"id": note_id, "title": title, "content": note.content,
            "updated_at": now}


@app.delete("/api/notes/{note_id}", status_code=204)
def delete_note(note_id: str):
    with get_db() as con:
        cur = con.execute("DELETE FROM notes WHERE id=?", (note_id,))
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="メモが見つかりません")


# ── File Upload ───────────────────────────────────────────────────────────────

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
ALLOWED_EXTENSIONS = {".xlsx", ".xls"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


@app.post("/api/upload")
async def upload_excel(file: UploadFile = File(...)):
    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Excelファイル(.xlsx/.xls)のみ許可されています")
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="ファイルサイズは10MB以下にしてください")
    safe_name = f"{uuid.uuid4()}{suffix}"
    (UPLOAD_DIR / safe_name).write_bytes(contents)
    return {"message": "アップロード成功", "saved_as": safe_name}


# ── Frontend ──────────────────────────────────────────────────────────────────

_HTML = Path("static/index.html").read_text()


@app.get("/", response_class=HTMLResponse)
def index():
    return HTMLResponse(_HTML)

