
"""Graph queries: blast radius, test ranking, and path explanation."""

import os

from falkordb import FalkorDB

import analyze


_graph = None
_graph_name = None
_db = None


def set_graph(graph_name: str):
    """Switch analysis to the selected repository graph."""
    global _graph, _graph_name, _db

    if not graph_name or not graph_name.replace("_", "").isalnum():
        raise ValueError("Invalid graph name.")

    host = os.getenv("FALKORDB_HOST", "localhost")
    port = int(os.getenv("FALKORDB_PORT", "6379"))
    username = os.getenv("FALKORDB_USERNAME") or None
    password = os.getenv("FALKORDB_PASSWORD") or None
    use_ssl = os.getenv("FALKORDB_SSL", "false").lower() == "true"
    ca_cert = os.getenv("FALKORDB_CA_CERT") or None

    connection_options = {
        "host": host,
        "port": port,
    }

    if username:
        connection_options["username"] = username

    if password:
        connection_options["password"] = password

    if use_ssl:
        connection_options["ssl"] = True
        if ca_cert:
            connection_options["ssl_ca_certs"] = ca_cert

    _db = FalkorDB(**connection_options)
    _graph = _db.select_graph(graph_name)
    _graph_name = graph_name


def graph():
    """Return the currently selected graph."""
    global _graph, _graph_name

    if _graph is None:
        set_graph(os.getenv("CR_GRAPH", "TestScope"))

    return _graph


def run(q, params=None):
    """Execute a graph query."""
    return graph().query(q, params or {}).result_set


def _dependents(files, max_hops):
    """Find modules that import changed files, directly or transitively."""
    files = list(dict.fromkeys(files))

    if not files:
        return {}

    max_hops = max(1, min(int(max_hops), 10))

    rows = run(
        f"""
        MATCH p = (d:Module)-[:IMPORTS*1..{max_hops}]->(m:Module)
        WHERE m.path IN $files
          AND NOT d.path IN $files
          AND all(
              n IN nodes(p)
              WHERE single(x IN nodes(p) WHERE x = n)
          )
        RETURN
            d.path,
            d.is_test,
            m.path,
            length(p),
            [n IN nodes(p) | n.path]
        ORDER BY length(p)
        LIMIT 20000
        """,
        {"files": files},
    )

    best = {}

    for d, is_test, m, hops, chain in rows:
        key = (d, m)

        if key not in best or hops < best[key][0]:
            best[key] = (hops, chain, bool(is_test))

    return best


def blast_radius(files, max_hops=3):
    """Summarize direct importers and downstream impact."""
    files = list(dict.fromkeys(files))

    if not files:
        return {
            "changed": [],
            "nearest_dependents": [],
            "tests_reached": 0,
        }

    best = _dependents(files, max_hops)
    summary = []

    for file_path in files:
        direct_rows = run(
            """
            MATCH (d:Module)-[:IMPORTS]->(m:Module {path: $p})
            WHERE NOT d.path IN $files
            RETURN count(DISTINCT d)
            """,
            {"p": file_path, "files": files},
        )

        direct = direct_rows[0][0] if direct_rows else 0

        total = len({
            dependent
            for (dependent, changed) in best
            if changed == file_path
        })

        summary.append({
            "file": file_path,
            "direct_importers": direct,
            f"dependents_within_{max_hops}_hops": total,
        })

    items = sorted(
        best.items(),
        key=lambda item: (item[1][0], item[0][0], item[0][1]),
    )[:40]

    nearest_dependents = [
        {
            "module": dependent,
            "is_test": is_test,
            "because_of": changed,
            "hops": hops,
            "chain": chain,
        }
        for (dependent, changed), (hops, chain, is_test) in items
    ]

    tests_reached = len({
        dependent
        for (dependent, _), (_, _, is_test) in best.items()
        if is_test
    })

    return {
        "changed": summary,
        "nearest_dependents": nearest_dependents,
        "tests_reached": tests_reached,
    }


def rank_tests(files, max_hops=3, top_k=10):
    """Rank tests using dependency distance and co-change history."""
    files = list(dict.fromkeys(files))

    if not files:
        return []

    best = _dependents(files, max_hops)
    scores = {}
    reasons = {}

    def add(test, points, why):
        scores[test] = scores.get(test, 0.0) + points
        reasons.setdefault(test, []).append(why)

    for (dependent, changed), (hops, chain, is_test) in best.items():
        if is_test:
            add(
                dependent,
                1.0 / hops,
                {
                    "type": "imports",
                    "changed": changed,
                    "hops": hops,
                    "chain": chain,
                },
            )

    co_changed = run(
        """
        MATCH (t:Module {is_test: true})-[c:CO_CHANGED]-(m:Module)
        WHERE m.path IN $files
          AND NOT t.path IN $files
        RETURN t.path, m.path, c.weight
        """,
        {"files": files},
    )

    for test, changed, weight in co_changed:
        points = 0.5 * min(float(weight or 0), 10) / 10.0

        add(
            test,
            points,
            {
                "type": "co_changed",
                "changed": changed,
                "times_changed_together": weight,
            },
        )

    for file_path in files:
        if analyze.is_test_path(file_path):
            add(
                file_path,
                2.0,
                {"type": "test_file_itself_changed"},
            )

    ranked = sorted(
        scores,
        key=lambda test: (-scores[test], test),
    )[:max(0, int(top_k))]

    return [
        {
            "test": test,
            "score": round(scores[test], 3),
            "evidence": reasons[test],
        }
        for test in ranked
    ]


def explain_path(module, test, max_hops=4):
    """Find the shortest simple import path from a test to a module."""
    max_hops = max(1, min(int(max_hops), 10))

    rows = run(
        f"""
        MATCH p = (t:Module {{path: $t}})-[:IMPORTS*1..{max_hops}]->(m:Module {{path: $m}})
        WHERE all(
            n IN nodes(p)
            WHERE single(x IN nodes(p) WHERE x = n)
        )
        RETURN [n IN nodes(p) | n.path], length(p)
        ORDER BY length(p)
        LIMIT 1
        """,
        {"t": test, "m": module},
    )

    co = run(
        """
        MATCH (a:Module {path: $t})-[c:CO_CHANGED]-(b:Module {path: $m})
        RETURN c.weight
        """,
        {"t": test, "m": module},
    )

    return {
        "import_chain": rows[0][0] if rows else None,
        "hops": rows[0][1] if rows else None,
        "times_changed_together": co[0][0] if co else 0,
    }


def all_tests():
    """Return all known test-module paths."""
    return [
        row[0]
        for row in run(
            "MATCH (t:Module {is_test: true}) RETURN t.path"
        )
    ]


def known_paths():
    """Return all known module paths."""
    return {
        row[0]
        for row in run("MATCH (m:Module) RETURN m.path")
    }
