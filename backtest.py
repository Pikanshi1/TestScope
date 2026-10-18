"""Backtest: for recent commits that changed both source and tests, predict the
tests from the source files alone, and check against the tests really changed.

Usage:
  python backtest.py --repo /path/to/repo --holdout 300 --n 20 --k 5

--holdout must equal the value used in build_graph.py, so the co-change edges
never saw these commits.
Known limit: import edges come from the current checkout, not each old commit.
"""
import argparse
from pathlib import Path

import analyze
import queries


def baseline(src_files, tests, k):
    """Naive baseline: tests whose filename matches a changed module's name."""
    picked = []
    for f in src_files:
        stem = Path(f).stem
        for t in tests:
            name = Path(t).name
            if stem != "__init__" and stem in name and t not in picked:
                picked.append(t)
    return picked[:k]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--holdout", type=int, default=300)
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--max-files", type=int, default=15)
    args = ap.parse_args()

    known = queries.known_paths()
    tests = queries.all_tests()
    commits = analyze.git_commits(args.repo, skip=0, limit=args.holdout)

    cases = []
    for h, files in commits:
        files = [f for f in files if f in known]
        src = [f for f in files if not analyze.is_test_path(f)]
        actual = [f for f in files if analyze.is_test_path(f)]
        if src and actual and len(files) <= args.max_files:
            cases.append((h, src, actual))
        if len(cases) == args.n:
            break

    stats = {"graph": [0, 0.0], "baseline": [0, 0.0]}
    lines = ["| commit | changed src | actual tests | graph hit | baseline hit |",
             "|---|---|---|---|---|"]
    for h, src, actual in cases:
        pred = [r["test"] for r in queries.rank_tests(src, top_k=args.k)]
        base = baseline(src, tests, args.k)
        for name, p in (("graph", pred), ("baseline", base)):
            inter = len(set(p) & set(actual))
            stats[name][0] += 1 if inter else 0
            stats[name][1] += inter / len(actual)
        lines.append(f"| {h[:8]} | {len(src)} | {len(actual)} | "
                     f"{'yes' if set(pred) & set(actual) else 'no'} | "
                     f"{'yes' if set(base) & set(actual) else 'no'} |")

    n = len(cases)
    if n == 0:
        raise SystemExit("No eligible commits found. Increase --holdout or --max-files.")
    summary = (f"\n**Cases:** {n}  |  **k:** {args.k}\n\n"
               f"- Graph: hit@{args.k} = {stats['graph'][0]}/{n}, "
               f"mean recall@{args.k} = {stats['graph'][1] / n:.2f}\n"
               f"- Filename baseline: hit@{args.k} = {stats['baseline'][0]}/{n}, "
               f"mean recall@{args.k} = {stats['baseline'][1] / n:.2f}\n")
    text = "# Backtest results\n\n" + "\n".join(lines) + "\n" + summary
    Path("backtest_results.md").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
