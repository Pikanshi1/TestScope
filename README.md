# TestScope

**Predict the blast radius of code changes and identify which tests deserve attention first.**

TestScope is a graph-powered test impact analysis tool built for **Graph Hacks — Track 01: Agents That Act on Connected Data**. It uses FalkorDB to model relationships between Python modules and combines graph evidence with an AI-generated explanation to help developers investigate code changes.

## The Problem

When a developer changes a module, it can be difficult to determine which other modules and tests may be affected. Running every test can be expensive, while running too few can miss important regressions.

TestScope helps developers understand the potential impact of a change and prioritize relevant tests.

## Features

- **Repository indexing:** Analyze a Python repository and build its dependency graph.
- **Graph visualization:** Explore modules, test files, and their relationships.
- **Impact analysis:** Identify potentially affected modules within the configured graph traversal depth.
- **Ranked test recommendations:** Prioritize candidate tests using graph relationships and historical co-change information.
- **AI-generated report:** Explain the recommendations, supporting evidence, and uncertainty.

## How It Works

1. **Index:** Scan Python files and extract static import relationships.
2. **Build the graph:** Store module nodes and `IMPORTS` and `CO_CHANGED` relationships in FalkorDB.
3. **Analyze changes:** Traverse the graph to identify potentially affected modules and rank test candidates.
4. **Explain:** Use an AI agent to summarize the graph evidence and produce an actionable test plan.

## Architecture

```text
Python Repository
       |
       v
Static Import Analysis + Git History
       |
       v
     FalkorDB
  Module Relationship Graph
       |
       v
   FastAPI Backend
       |
       +------> Graph Data
       |
       +------> Impact Analysis
       |              |
       |              v
       |        Ranked Tests
       |
       +------> AI Explanation
                      |
                      v
              React Dashboard
```

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS
- **Backend:** Python, FastAPI
- **Graph database:** FalkorDB
- **AI:** Groq API
- **Analysis:** Python AST, Git history, Cypher graph queries

## Run Locally

### Prerequisites

Python, Node.js/npm, Docker, and a Groq API key for AI-generated reports.

### 1. Start FalkorDB

```bash
docker run -d --name testscope-db \
  -p 6379:6379 -p 3000:3000 \
  falkordb/falkordb:latest
```

### 2. Install Python dependencies

From the repository root:

```bash
pip install -r requirements.txt
```

Set your Groq API key in your environment if you want AI-generated reports.

### 3. Start the backend

```bash
uvicorn server:app --reload --port 8000
```

API documentation: `http://localhost:8000/docs`

### 4. Start the frontend

In a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

## Scope and Limitations

- Current static analysis focuses on Python repositories.
- Dynamic imports and runtime behavior may not be captured by the graph.
- Historical co-changes are signals of association, not proof of dependency.
- Test recommendations are candidates for prioritization; TestScope does not execute the recommended tests.

## Built For

**Graph Hacks — Agents That Act on Connected Data**

TestScope uses FalkorDB as its graph context layer so that test recommendations can be explained using relationships between code modules.