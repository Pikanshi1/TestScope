"""MCP server: exposes TestScope's graph tools to any MCP client.

Run:  python mcp_server.py      (stdio transport)
"""
from mcp.server.fastmcp import FastMCP

import queries

mcp = FastMCP("testscope")


@mcp.tool()
def blast_radius(files: list[str], max_hops: int = 3) -> dict:
    """Show modules and tests downstream of the changed files (repo-relative paths)."""
    return queries.blast_radius(files, max_hops)


@mcp.tool()
def rank_tests(files: list[str], top_k: int = 10) -> list[dict]:
    """Rank tests to run for the changed files, with graph evidence for each."""
    return queries.rank_tests(files, top_k=top_k)


@mcp.tool()
def explain_path(module: str, test: str) -> dict:
    """Explain why a test is connected to a module: import chain and co-change history."""
    return queries.explain_path(module, test)


if __name__ == "__main__":
    mcp.run()
