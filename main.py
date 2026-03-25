import os
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import HTMLResponse

app = FastAPI(title="Excel Upload")

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {".xlsx", ".xls"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


@app.get("/", response_class=HTMLResponse)
async def index():
    return """
    <html>
    <body>
        <h2>Excelファイルアップロード</h2>
        <form action="/upload" method="post" enctype="multipart/form-data">
            <input type="file" name="file" accept=".xlsx,.xls" required>
            <button type="submit">アップロード</button>
        </form>
    </body>
    </html>
    """


@app.post("/upload")
async def upload_excel(file: UploadFile = File(...)):
    # ファイル拡張子チェック
    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Excelファイル(.xlsx/.xls)のみ許可されています")

    # ファイルサイズチェック
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="ファイルサイズは10MB以下にしてください")

    # ランダムなファイル名で保存（パストラバーサル防止）
    safe_name = f"{uuid.uuid4()}{suffix}"
    save_path = UPLOAD_DIR / safe_name
    save_path.write_bytes(contents)

    return {"message": "アップロード成功", "saved_as": safe_name}
