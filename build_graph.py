
"""Build a TestScope graph for any local Git repository."""

import argparse
import os

from falkordb import FalkorDB
import analyze

BATCH = 1000


def chunks(rows):
    for i in range(0, len(rows), BATCH):
        yield rows[i:i + BATCH]


def build_graph_for_repo(repo, graph_name, history=1500, holdout=300):
    """Scan a repository and build its graph in FalkorDB."""
    repo = os.path.abspath(repo)

    mods = analyze.scan_modules(repo)
    if not mods:
        raise ValueError("No Python files found in this repository.")

    imports = analyze.import_edges(mods)
    if history > 0:
        commits = analyze.git_commits(repo, skip=holdout, limit=history)
        cochange = analyze.cochange_edges(commits, mods.keys())
    else:
        commits = []
        cochange = []

    db = FalkorDB(
        host=os.getenv("FALKORDB_HOST", "localhost"),
        port=int(os.getenv("FALKORDB_PORT", "6379")),
    )
    g = db.select_graph(graph_name)

    try:
        g.delete()
    except Exception:
        pass

    g = db.select_graph(graph_name)

    nodes = [
        {"path": path, "is_test": analyze.is_test_path(path)}
        for path in mods
    ]

    for part in chunks(nodes):
        g.query(
            "UNWIND $rows AS r "
            "CREATE (:Module {path: r.path, is_test: r.is_test})",
            {"rows": part},
        )

    try:
        g.query("CREATE INDEX FOR (m:Module) ON (m.path)")
    except Exception:
        pass

    for part in chunks([{"s": a, "d": b} for a, b in imports]):
        g.query(
            "UNWIND $rows AS r "
            "MATCH (a:Module {path: r.s}), (b:Module {path: r.d}) "
            "CREATE (a)-[:IMPORTS]->(b)",
            {"rows": part},
        )

    for part in chunks(
        [{"a": a, "b": b, "w": w} for a, b, w in cochange]
    ):
        g.query(
            "UNWIND $rows AS r "
            "MATCH (a:Module {path: r.a}), (b:Module {path: r.b}) "
            "CREATE (a)-[:CO_CHANGED {weight: r.w}]->(b)",
            {"rows": part},
        )

    node_count = g.query(
        "MATCH (m:Module) RETURN count(m)"
    ).result_set[0][0]

    return node_count


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument(
        "--graph", default=os.getenv("CR_GRAPH", "TestScope")
    )
    parser.add_argument("--history", type=int, default=1500)
    parser.add_argument("--holdout", type=int, default=300)
    args = parser.parse_args()

    build_graph_for_repo(
        args.repo, args.graph, args.history, args.holdout
    )


if __name__ == "__main__":
    main()
