from datetime import datetime
from pathlib import Path
from urllib.parse import quote, urlparse
import json
import os
import re
import shutil
import sys

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[2]
sys.path.append(str(ROOT))

from engine.pipeline import run_phase2_pipeline
from services.gis.vworld_client import VWorldError

app = FastAPI(title="FAM Architecture API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
SAVED_MODEL_DIR = STATIC_DIR / "saved_models"
API_BASE_URL = os.getenv("FAM_API_BASE_URL", "http://localhost:8002")


class SiteRequest(BaseModel):
    address: str
    buildingUse: str | None = None
    modelSettings: dict | None = None
    regulationOverrides: dict | None = None


class ModelSaveRequest(BaseModel):
    parcelKey: str | None = None
    state: dict


def _safe_path_part(value: str | None, fallback: str) -> str:
    text = str(value or "").strip() or fallback
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text[:120] or fallback


def _saved_model_url(folder: str, filename: str) -> str:
    return f"{API_BASE_URL}/static/saved_models/{quote(folder)}/{quote(filename)}"


def _copy_model_if_local(model_url: str | None, target_folder: Path, stem: str) -> str | None:
    if not model_url:
        return None
    parsed = urlparse(model_url)
    path = parsed.path or model_url
    marker = "/static/"
    if marker not in path:
        return model_url

    relative = path.split(marker, 1)[1].lstrip("/\\")
    source = (STATIC_DIR / relative).resolve()
    static_root = STATIC_DIR.resolve()
    if static_root not in source.parents or not source.exists() or source.suffix.lower() != ".glb":
        return model_url

    target = target_folder / f"{stem}.glb"
    shutil.copy2(source, target)
    return _saved_model_url(target_folder.name, target.name)


def _save_summary(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {}
    return {
        "id": f"{path.parent.name}/{path.name}",
        "parcelKey": path.parent.name,
        "filename": path.name,
        "savedAt": data.get("savedAt") or path.stem,
        "address": (data.get("state") or {}).get("address", ""),
    }


@app.get("/health")
def health():
    return {"status": "ok", "phase": 2}


@app.post("/generate")
def generate_site(req: SiteRequest):
    try:
        return run_phase2_pipeline(
            req.address,
            building_use=req.buildingUse,
            model_settings=req.modelSettings,
            regulation_overrides=req.regulationOverrides,
        )
    except VWorldError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/models/save")
def save_model(req: ModelSaveRequest):
    state = dict(req.state or {})
    parcel_data = state.get("parcel") or {}
    parcel_key = _safe_path_part(
        req.parcelKey or parcel_data.get("address") or state.get("address"),
        "unknown-parcel",
    )
    saved_at = datetime.now().strftime("%Y%m%d_%H%M%S")
    folder = SAVED_MODEL_DIR / parcel_key
    folder.mkdir(parents=True, exist_ok=True)

    stem = saved_at
    path = folder / f"{stem}.json"
    suffix = 1
    while path.exists():
        stem = f"{saved_at}_{suffix}"
        path = folder / f"{stem}.json"
        suffix += 1

    model_url = _copy_model_if_local(state.get("modelUrl"), folder, stem)
    if model_url:
        state["modelUrl"] = model_url

    payload = {
        "version": 1,
        "savedAt": saved_at,
        "parcelKey": parcel_key,
        "state": state,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "success": True,
        "save": _save_summary(path),
    }


@app.get("/models/saves")
def list_saved_models(parcelKey: str | None = None):
    if not SAVED_MODEL_DIR.exists():
        return {"success": True, "saves": []}

    if parcelKey:
        folder = SAVED_MODEL_DIR / _safe_path_part(parcelKey, "unknown-parcel")
        paths = sorted(folder.glob("*.json"), reverse=True) if folder.exists() else []
    else:
        paths = sorted(SAVED_MODEL_DIR.glob("*/*.json"), reverse=True)

    return {
        "success": True,
        "saves": [_save_summary(path) for path in paths],
    }


@app.get("/models/saves/{folder}/{filename}")
def load_saved_model(folder: str, filename: str):
    safe_folder = _safe_path_part(folder, "unknown-parcel")
    safe_filename = _safe_path_part(filename, "unknown.json")
    if not safe_filename.endswith(".json"):
        safe_filename = f"{safe_filename}.json"

    path = (SAVED_MODEL_DIR / safe_folder / safe_filename).resolve()
    root = SAVED_MODEL_DIR.resolve()
    if root not in path.parents or not path.exists():
        raise HTTPException(status_code=404, detail="저장된 모델을 찾을 수 없습니다.")

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="저장 파일을 읽을 수 없습니다.") from exc
