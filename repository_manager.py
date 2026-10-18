
import os
import re
import shutil
import tempfile
import threading
from pathlib import Path
from urllib.parse import urlparse
from dotenv import load_dotenv

import requests
import build_graph

BASE_DIR = Path(tempfile.gettempdir()) / "testscope-repositories"
BASE_DIR.mkdir(parents=True, exist_ok=True)

_lock = threading.Lock()
_active_repo = None

load_dotenv()

API_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

token = os.getenv("GITHUB_TOKEN")
if token:
    API_HEADERS["Authorization"] = f"Bearer {token}"

def validate_github_url(url: str):
    parsed = urlparse(url.strip())
    if parsed.scheme != "https" or parsed.hostname != "github.com":
        raise ValueError("Use https://github.com/owner/repo")

    parts = parsed.path.strip("/").removesuffix(".git").split("/")
    if len(parts) != 2 or not all(
        re.fullmatch(r"[A-Za-z0-9_.-]+", p) and p not in {".", ".."}
        for p in parts
    ):
        raise ValueError("Invalid GitHub repository URL.")

    return parts[0], parts[1]


def prepare_repository(url: str) -> dict:
    global _active_repo

    owner, repo_name = validate_github_url(url)
    graph_name = re.sub(
        r"[^A-Za-z0-9_]", "_", f"ts_{owner}_{repo_name}"
    )[:100]

    api = f"https://api.github.com/repos/{owner}/{repo_name}"

    with _lock:
        repo_dir = Path(tempfile.mkdtemp(
            prefix=f"{graph_name}_", dir=str(BASE_DIR)
        ))

        try:
            print("[API] Fetching repository metadata...", flush=True)
            response = requests.get(api, headers=API_HEADERS, timeout=20)
            response.raise_for_status()
            metadata = response.json()
            branch = metadata["default_branch"]

            print(f"[API] Fetching tree for branch {branch}...", flush=True)
            response = requests.get(
                f"{api}/git/trees/{branch}?recursive=1",
                headers=API_HEADERS,
                timeout=40,
            )
            response.raise_for_status()
            tree = response.json()["tree"]

            files = [
                item for item in tree
                if item["type"] == "blob"
                and item["path"].endswith(".py")
                and "size" in item
                and item["size"] <= 1_000_000
            ]

            if not files:
                raise ValueError("No Python files found in this repository.")

            print(f"[API] Downloading {len(files)} Python files...", flush=True)

            for item in files:
                path = Path(item["path"])
                destination = repo_dir / path
                destination.parent.mkdir(parents=True, exist_ok=True)

                file_response = requests.get(
                    item["url"], headers=API_HEADERS, timeout=20
                )
                file_response.raise_for_status()
                file_data = file_response.json()

                import base64
                content = base64.b64decode(file_data["content"])
                destination.write_bytes(content)

            print("[API] Source files downloaded.", flush=True)

            count = build_graph.build_graph_for_repo(
                str(repo_dir), graph_name, history=0, holdout=0
            )

            _active_repo = {
                "url": url,
                "name": f"{owner}/{repo_name}",
                "path": str(repo_dir),
                "graph": graph_name,
            }

            return {
                "repository": _active_repo["name"],
                "graph": graph_name,
                "python_files": count,
            }

        except Exception:
            shutil.rmtree(repo_dir, ignore_errors=True)
            raise


def active_repository():
    return _active_repo
