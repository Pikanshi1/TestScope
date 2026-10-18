
"""TestScope API — exposes the existing graph analysis to the dashboard."""

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import repository_manager
import subprocess

load_dotenv(override=True)

import agent
import queries

app = FastAPI(title="TestScope API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173","https://test-scope.vercel.app"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    files: list[str] = Field(min_length=1, max_length=20)
    include_ai: bool = True


class RepositoryRequest(BaseModel):
    url: str = Field(min_length=1, max_length=300)    


@app.get("/health")
def health():
    return {"status": "ok", "service": "TestScope API"}


@app.post("/repository")
def select_repository(request: RepositoryRequest):
    try:
        result = repository_manager.prepare_repository(request.url)
        queries.set_graph(result["graph"])
        response = {
            "message": "Repository indexed successfully.",
            **result,
        }
        return response

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=408,
            detail="Repository cloning timed out. Try a smaller repository.",
        )
    except Exception as exc:
        print(f"[ERROR] {exc!r}", flush=True)
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/tests")
def list_tests():
    try:
        return {"tests": sorted(queries.all_tests())}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@app.get("/graph")
def get_graph():
    try:
        nodes = queries.run(
            """
            MATCH (m:Module)
            RETURN m.path, m.is_test
            ORDER BY m.path
            """
        )

        edges = queries.run(
            """
            MATCH (a:Module)-[r]->(b:Module)
            RETURN a.path, type(r), b.path
            """
        )

        return {
            "nodes": [
                {"id": row[0], "is_test": bool(row[1])}
                for row in nodes
            ],
            "edges": [
                {"source": row[0], "type": row[1], "target": row[2]}
                for row in edges
            ],
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@app.post("/analyze")
def analyze(request: AnalyzeRequest):
    files = [f.strip().replace("\\", "/") for f in request.files]

    if any(
        not f.endswith(".py")
        or f.startswith("/")
        or ".." in Path(f).parts
        for f in files
    ):
        raise HTTPException(
            status_code=400,
            detail="Provide relative Python file paths, such as src/requests/sessions.py",
        )

    files = list(dict.fromkeys(files))

    try:
        known = queries.known_paths()
        unknown = [f for f in files if f not in known]

        if unknown:
            raise HTTPException(
                status_code=404,
                detail={"unknown_files": unknown, "message": "Files not found in the graph."},
            )

        impact = queries.blast_radius(files, max_hops=3)
        ranked_tests = queries.rank_tests(files, max_hops=3, top_k=10)

        ai_report = None
        ai_error = None

        if request.include_ai:
            try:
                ai_report = agent.investigate(files)
            except Exception as exc:
                ai_error = str(exc)

        return {
            "changed_files": files,
            "impact": impact,
            "ranked_tests": ranked_tests,
            "ai_report": ai_report,
            "ai_error": ai_error,
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))
