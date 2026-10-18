"""Extract module import edges (via ast) and co-change edges (via git log)."""
import ast
import subprocess
from collections import Counter
from itertools import combinations
from pathlib import Path

SKIP_DIRS = {".git", ".venv", "venv", "env", "node_modules", "build", "dist",
             "docs", "__pycache__", ".tox", ".eggs", "site-packages"}


def is_test_path(rel: str) -> bool:
    name = Path(rel).name
    return name.startswith("test_") or name.endswith("_test.py")


def _parts(rel: str):
    parts = rel[:-3].split("/")
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return parts


def _canonical_parts(rel: str):
    parts = _parts(rel)
    if parts and parts[0] in ("src", "lib","backend") and len(parts) > 1:
        parts = parts[1:]
    return parts


def scan_modules(repo):
    """Return {relative_path: source_text} for all .py files in the repo."""
    repo = Path(repo).resolve()
    mods = {}
    for p in repo.rglob("*.py"):
        relparts = p.relative_to(repo).parts
        if any(part in SKIP_DIRS for part in relparts[:-1]):
            continue
        try:
            mods[p.relative_to(repo).as_posix()] = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
    return mods


def build_name_map(rels):
    name_map = {}
    for rel in sorted(rels):
        for parts in (_canonical_parts(rel), _parts(rel)):
            if parts:
                name_map.setdefault(".".join(parts), rel)
    return name_map


def _resolve(name_map, dotted):
    parts = dotted.split(".")
    while parts:
        cand = ".".join(parts)
        if cand in name_map:
            return name_map[cand]
        parts.pop()
    return None


def extract_imports(rel, source, name_map):
    """Return the set of repo-relative paths that `rel` imports."""
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return set()
    canon = _canonical_parts(rel)
    pkg = canon if rel.endswith("__init__.py") else canon[:-1]
    targets = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                t = _resolve(name_map, a.name)
                if t:
                    targets.add(t)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                keep = max(0, len(pkg) - (node.level - 1))
                base_parts = list(pkg[:keep]) + ([node.module] if node.module else [])
                base = ".".join(base_parts)
            else:
                base = node.module or ""
            if base:
                t = _resolve(name_map, base)
                if t:
                    targets.add(t)
            for a in node.names:
                if a.name == "*":
                    continue
                sub = f"{base}.{a.name}" if base else a.name
                if sub in name_map:
                    targets.add(name_map[sub])
    targets.discard(rel)
    return targets


def import_edges(mods):
    name_map = build_name_map(mods.keys())
    edges = []
    for rel, src in mods.items():
        for t in extract_imports(rel, src, name_map):
            edges.append((rel, t))
    return edges


def git_commits(repo, skip=0, limit=1000):
    """Return [(hash, [files])] newest first, merges excluded."""
    cmd = ["git", "-C", str(repo), "log", "--no-merges", "--name-only",
           "--pretty=format:COMMIT\t%H", f"--skip={skip}", f"-n{limit}"]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    commits, cur_hash, cur_files = [], None, []
    for line in out.splitlines():
        if line.startswith("COMMIT\t"):
            if cur_hash:
                commits.append((cur_hash, cur_files))
            cur_hash, cur_files = line.split("\t", 1)[1], []
        elif line.strip():
            cur_files.append(line.strip())
    if cur_hash:
        commits.append((cur_hash, cur_files))
    return commits


def cochange_edges(commits, known_paths, max_files=30, min_weight=2):
    """Count how often two known .py files changed in the same commit."""
    known = set(known_paths)
    counter = Counter()
    for _, files in commits:
        fs = sorted({f for f in files if f in known})
        if 2 <= len(fs) <= max_files:
            for a, b in combinations(fs, 2):
                counter[(a, b)] += 1
    return [(a, b, w) for (a, b), w in counter.items() if w >= min_weight]
