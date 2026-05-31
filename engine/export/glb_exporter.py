from pathlib import Path
import os
import uuid

import trimesh

BASE_DIR = Path(__file__).resolve().parents[2]
OUTPUT_DIR = BASE_DIR / "apps" / "api" / "static" / "models"
API_BASE_URL = os.getenv("FAM_API_BASE_URL", "http://localhost:8002")
SceneGeometry = trimesh.Trimesh | tuple[str, trimesh.Trimesh]


def export_glb(mesh: trimesh.Trimesh) -> str:
    return export_scene(mesh)


def export_scene(*meshes: SceneGeometry) -> str:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    filename = f"{uuid.uuid4()}.glb"
    path = OUTPUT_DIR / filename

    if len(meshes) == 1 and not isinstance(meshes[0], tuple):
        meshes[0].export(path)
    else:
        scene = trimesh.Scene()
        for index, item in enumerate(meshes):
            if isinstance(item, tuple):
                name, mesh = item
            else:
                name, mesh = f"mesh_{index}", item
            scene.add_geometry(mesh, geom_name=name)
        scene.export(path)

    return f"{API_BASE_URL}/static/models/{filename}"
