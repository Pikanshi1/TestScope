# TestScope

An agent that predicts the blast radius of a code change. FalkorDB stores a graph
of a repo's modules, import edges and historical co-change edges. The agent queries
the graph through tools, then writes a ranked test plan where every test carries the
graph evidence behind it. Built for Graph Hacks (Track 01: Agents That Act on Connected Data).

## How it works

```
target repo --ast--> Module nodes + IMPORTS edges  --\
target repo --git log--> CO_CHANGED edges (weighted) --+--> FalkorDB
                                                        |
   changed files --> Cypher multi-hop traversal <-------+
                 --> score tests (hop distance + co-change history)
                 --> LLM agent explains, states uncertainty, writes report
```

Graph model: `(:Module {path, is_test})`, `(a)-[:IMPORTS]->(b)`, `(a)-[:CO_CHANGED {weight}]-(b)`.

## Setup

```bash
docker run -p 6379:6379 -p 3000:3000 --rm falkordb/falkordb:latest   # DB + Browser on :3000
pip install -r requirements.txt
git clone https://github.com/psf/requests /tmp/requests               # target repo (or any Python repo)
export GROQ_API_KEY=your_key
```

## Run

```bash
# 1. Build the graph (holdout keeps the newest 300 commits out of the co-change data)
python build_graph.py --repo /tmp/requests --history 1500 --holdout 300

# 2. Investigate a change
python agent.py --files src/requests/sessions.py src/requests/utils.py
#    or: python agent.py --repo /tmp/requests --diff HEAD~1

# 3. Backtest on past commits (same --holdout as step 1)
python backtest.py --repo /tmp/requests --holdout 300 --n 20 --k 5

# Optional: serve the tools over MCP
python mcp_server.py
```

File paths must match the repo layout (for `requests` that is `src/requests/...`).

## Limitations (stated honestly)

- Python only. Dynamic imports, runtime wiring, config and non-Python files are invisible.
- Import edges come from the current checkout, not from each historical commit.
- Backtest ground truth is "tests changed in the same commit", a proxy for the tests that mattered.
- Results come from one repo and about 20 commits; they are not a general accuracy claim.

## Results

Backtest results have not yet been published. Run the backtest command to generate local results in `backtest_results.md`.
