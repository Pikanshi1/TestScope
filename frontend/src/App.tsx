import { useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Bug,
  CheckCircle2,
  FileCode2,
  GitBranch,
  LoaderCircle,
  Play,
  ShieldCheck,
  Sparkles,
  Terminal,
  XCircle,
} from "lucide-react";

const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:8000"
).replace(/\/$/, "");

type TestEvidence = {
  type?: string;
  changed?: string;
  hops?: number;
  chain?: string[];
  times_changed_together?: number;
};

type RankedTest = {
  test?: string;
  test_file?: string;
  path?: string;
  score?: number | string;
  reason?: string;
  evidence?: TestEvidence[];
  [key: string]: unknown;
};

type ImpactData = {
  changed?: {
    file: string;
    direct_importers?: number;
    dependents_within_3_hops?: number;
  }[];
  nearest_dependents?: {
    module: string;
    is_test?: boolean;
    because_of?: string;
    hops?: number;
    chain?: string[];
  }[];
  tests_reached?: number;
};

type AnalysisResult = {
  impact?: ImpactData | unknown;
  ranked_tests?: RankedTest[] | unknown;
  ai_report?: string | null;
  ai_error?: string | null;
  [key: string]: unknown;
};

type IndexedRepository = {
  repository: string;
  graph: string;
  python_files: number;
};

type GraphNode = {
  id: string;
  is_test: boolean;
};

type GraphEdge = {
  source: string;
  target: string;
  type: string;
};

type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "No data available";
  }

  if (typeof value === "string") {
    return value || "No data available";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getTestName(test: RankedTest): string {
  return test.test_file || test.test || test.path || "Unnamed test";
}

function decodeMarkdownEntities(value: string): string {
  return value
    .replace(/&#x20;/gi, " ")
    .replace(/&gt;/gi, ">")
    .replace(/&lt;/gi, "<")
    .replace(/&amp;/gi, "&");
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = decodeMarkdownEntities(text).split(
    /(\*\*.*?\*\*|`[^`]+`|\*[^*]+\*)/g,
  );

  return parts.filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={index}
          className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[0.9em] text-blue-700"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return <span key={index}>{part}</span>;
  });
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderAIReport(report: string): ReactNode[] {
  const lines = decodeMarkdownEntities(report).replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || /^---+\s*$/.test(line)) {
      i += 1;
      continue;
    }

    // Render Markdown tables as accessible, horizontally scrollable tables.
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1].trim())
    ) {
      const headers = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes("|")) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push(
        <div
          key={key++}
          className="overflow-x-auto rounded-lg border border-slate-200"
        >
          <table className="w-full min-w-[520px] border-collapse text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 text-slate-800">
              <tr>
                {headers.map((header, index) => (
                  <th
                    key={index}
                    className="border-b border-slate-200 px-3 py-3 font-semibold"
                  >
                    {renderInlineMarkdown(header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className="odd:bg-white even:bg-slate-50"
                >
                  {headers.map((_, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="border-b border-slate-100 px-3 py-3 align-top leading-6 text-slate-700"
                    >
                      {renderInlineMarkdown(row[cellIndex] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const classes =
        level === 1
          ? "text-lg font-bold text-slate-900"
          : level === 2
            ? "text-base font-semibold text-slate-900"
            : "text-sm font-semibold text-violet-700";
      blocks.push(
        <h5 key={key++} className={`${classes} ${blocks.length ? "pt-2" : ""}`}>
          {renderInlineMarkdown(heading[2])}
        </h5>,
      );
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, "").trim());
        i += 1;
      }
      blocks.push(
        <ul
          key={key++}
          className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700"
        >
          {items.map((item, index) => (
            <li key={index}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, "").trim());
        i += 1;
      }
      blocks.push(
        <ol
          key={key++}
          className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-700"
        >
          {items.map((item, index) => (
            <li key={index}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraph: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,4}\s+/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+[.)]\s+/.test(lines[i].trim()) &&
      !(
        lines[i].includes("|") &&
        i + 1 < lines.length &&
        isTableSeparator(lines[i + 1].trim())
      )
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push(
      <p key={key++} className="break-words text-sm leading-7 text-slate-700">
        {renderInlineMarkdown(paragraph.join(" "))}
      </p>,
    );
  }

  return blocks;
}

export default function App() {
  const [activePage, setActivePage] = useState<"overview" | "analysis">("overview");
  const [files, setFiles] = useState("src/requests/sessions.py");
  const [includeAI, setIncludeAI] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [graphError, setGraphError] = useState("");
  const [graphLoading, setGraphLoading] = useState(false);

  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [repositoryError, setRepositoryError] = useState("");
  const [indexedRepository, setIndexedRepository] =
    useState<IndexedRepository | null>(null);

  async function loadGraph() {
    setGraphLoading(true);
    setGraphError("");

    try {
      const response = await fetch(`${API_URL}/graph`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Failed to load graph.");
      }

      setGraphData(data);
      setSelectedNode(null);
    } catch (err) {
      setGraphError(
        err instanceof Error ? err.message : "Could not load the graph.",
      );
    } finally {
      setGraphLoading(false);
    }
  }

  async function indexRepository() {
    if (!repositoryUrl.trim()) {
      setRepositoryError("Please enter a GitHub repository URL.");
      return;
    }

    setIndexing(true);
    setRepositoryError("");
    setError("");
    setResult(null);
    setIndexedRepository(null);

    try {
      const response = await fetch(`${API_URL}/repository`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: repositoryUrl.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Failed to index the repository.",
        );
      }

      setIndexedRepository({
        repository: data.repository,
        graph: data.graph,
        python_files: data.python_files,
      });

      setFiles("");
      await loadGraph();
    } catch (err) {
      setRepositoryError(
        err instanceof Error
          ? err.message
          : "Could not index the repository. Check that the API is running.",
      );
    } finally {
      setIndexing(false);
    }
  }

  async function runAnalysis() {
    const selectedFiles = files
      .split("\n")
      .map((file) => file.trim())
      .filter(Boolean);

    if (!indexedRepository) {
      setError("Please index a GitHub repository first.");
      return;
    }

    if (selectedFiles.length === 0) {
      setError("Enter at least one file path to analyze.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch(`${API_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: selectedFiles,
          include_ai: includeAI,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Analysis failed. Please check the API response.",
        );
      }

      setResult(data as AnalysisResult);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not connect to the TestScope API.",
      );
    } finally {
      setLoading(false);
    }
  }

  const rankedTests = Array.isArray(result?.ranked_tests)
    ? (result.ranked_tests as RankedTest[])
    : [];

  const impactData = (
    result?.impact && typeof result.impact === "object" ? result.impact : {}
  ) as ImpactData;

  const changedFiles = Array.isArray(impactData.changed)
    ? impactData.changed
    : [];

  const dependentCount = changedFiles.reduce(
    (total, file) => total + (file.dependents_within_3_hops ?? 0),
    0,
  );

  const directImporterCount = changedFiles.reduce(
    (total, file) => total + (file.direct_importers ?? 0),
    0,
  );

  const testsReached = impactData.tests_reached ?? 0;

  return (
    <div className="min-h-screen bg-[#F6F8FC] text-slate-900">
      {/* Background effects */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-blue-200/50 blur-[120px]" />
        <div className="absolute right-0 top-40 h-96 w-96 rounded-full bg-violet-200/50 blur-[140px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-8">
        {/* Navbar */}
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-blue-200 bg-blue-50">
              <ShieldCheck className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">TestScope</h1>
              <p className="text-xs text-slate-500">
                Graph-powered test intelligence
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="Main navigation">
            <button type="button" onClick={() => setActivePage("overview")} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${activePage === "overview" ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}>Overview</button>
            <button type="button" onClick={() => setActivePage("analysis")} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${activePage === "analysis" ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}>Impact analysis</button>
          </nav>
        </header>

        {activePage === "overview" && (
          <>
        {/* Hero */}
        <section className="relative mb-8 grid items-center gap-5 overflow-hidden rounded-3xl border border-blue-100 bg-gradient-to-br from-white via-blue-50/80 to-violet-50 px-6 py-7 shadow-sm sm:px-9 sm:py-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="relative z-10">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm"><Sparkles className="h-3.5 w-3.5" />Graph-powered test intelligence</div>
            <h2 className="text-4xl font-bold leading-tight tracking-tight text-slate-900 sm:text-5xl">Understand your code.<span className="block bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">Test what matters.</span></h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-slate-600 sm:text-base">Explore code relationships, understand change impact, and prioritize tests using the graph evidence already available in TestScope.</p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-medium text-slate-700"><span className="rounded-full border border-blue-100 bg-white/90 px-3 py-2">Dependency graph</span><span className="rounded-full border border-violet-100 bg-white/90 px-3 py-2">Test ranking</span><span className="rounded-full border border-blue-100 bg-white/90 px-3 py-2">Optional AI report</span></div>
            <button type="button" onClick={() => setActivePage("analysis")} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700">Open impact analysis <ArrowRight className="h-4 w-4" /></button>
          </div>
          <div className="relative mx-auto w-full max-w-md" aria-hidden="true">
            <svg viewBox="0 0 420 270" className="h-auto w-full">
              <defs><linearGradient id="scopeLine" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#60A5FA" /><stop offset="100%" stopColor="#A78BFA" /></linearGradient><radialGradient id="scopeGlow"><stop offset="0%" stopColor="#93C5FD" stopOpacity=".45" /><stop offset="100%" stopColor="#C4B5FD" stopOpacity="0" /></radialGradient></defs>
              <circle cx="218" cy="135" r="125" fill="url(#scopeGlow)" />
              <g fill="none" stroke="url(#scopeLine)" strokeWidth="2" opacity=".8"><path d="M210 132 L106 70 L58 122 L119 194 L210 132 L309 74 L365 124 L306 202 L210 132 L211 235" /><path d="M106 70 L210 34 L309 74 M119 194 L211 235 L306 202" strokeDasharray="5 7" opacity=".65" /></g>
              <g fill="#FFFFFF" stroke="#93C5FD" strokeWidth="2"><circle cx="106" cy="70" r="15" /><circle cx="58" cy="122" r="11" /><circle cx="119" cy="194" r="13" /><circle cx="210" cy="34" r="12" /><circle cx="309" cy="74" r="15" /><circle cx="365" cy="124" r="11" /><circle cx="306" cy="202" r="14" /><circle cx="211" cy="235" r="12" /></g>
              <g fill="#3B82F6"><circle cx="106" cy="70" r="5" /><circle cx="58" cy="122" r="4" /><circle cx="119" cy="194" r="5" /><circle cx="210" cy="34" r="4" /><circle cx="309" cy="74" r="5" /><circle cx="365" cy="124" r="4" /><circle cx="306" cy="202" r="5" /><circle cx="211" cy="235" r="4" /></g>
              <circle cx="210" cy="132" r="38" fill="#DBEAFE" opacity=".9" /><circle cx="210" cy="132" r="29" fill="url(#scopeLine)" /><text x="210" y="139" textAnchor="middle" fontSize="20" fontWeight="700" fill="#FFFFFF">&lt;/&gt;</text>
              <g fill="#7C3AED" stroke="#FFFFFF" strokeWidth="3"><circle cx="119" cy="194" r="7" /><circle cx="306" cy="202" r="7" /></g>
              <g fill="#64748B" fontSize="10" fontWeight="600"><text x="78" y="48">MODULE</text><text x="317" y="52">DEPENDENCY</text><text x="230" y="260">TEST COVERAGE</text></g>
            </svg>
          </div>
        </section>

        {/* Repository indexing */}
        <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-900/5 sm:p-7">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-50">
                <GitBranch className="h-5 w-5 text-slate-800" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">
                  Connect a GitHub repository
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Index a public repository to build its code graph.
                </p>
              </div>
            </div>

            {indexedRepository && (
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Repository indexed
              </span>
            )}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void indexRepository();
            }}
            className="flex flex-col gap-3 sm:flex-row"
          >
            <div className="relative min-w-0 flex-1">
              <GitBranch className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="url"
                value={repositoryUrl}
                onChange={(event) => setRepositoryUrl(event.target.value)}
                placeholder="https://github.com/owner/repository"
                required
                disabled={indexing}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3.5 pl-11 pr-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-600 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 disabled:opacity-60"
              />
            </div>
            <button
              type="submit"
              disabled={indexing || loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {indexing ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Indexing...
                </>
              ) : (
                <>
                  <GitBranch className="h-4 w-4" />
                  Index Repository
                </>
              )}
            </button>
          </form>

          <p className="mt-3 text-xs text-slate-500">
            Public GitHub repositories only.
          </p>

          {repositoryError && (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{repositoryError}</p>
            </div>
          )}

          {indexedRepository && (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Repository indexed successfully
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="min-w-0">
                  <p className="mb-1 text-xs text-slate-500">Repository</p>
                  <p className="break-all text-sm font-medium text-slate-800">
                    {indexedRepository.repository}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-xs text-slate-500">Python files</p>
                  <p className="text-sm font-semibold text-slate-800">
                    {indexedRepository.python_files}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-xs text-slate-500">FalkorDB graph</p>
                  <p className="break-all font-mono text-sm text-blue-700">
                    {indexedRepository.graph}
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Interactive repository graph */}
        <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-900/5 sm:p-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Repository Graph</h3>
              <p className="mt-1 text-sm text-slate-600">
                Explore module relationships stored in FalkorDB.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void loadGraph()}
              disabled={graphLoading || !indexedRepository}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-40"
            >
              {graphLoading ? "Loading..." : "Refresh graph"}
            </button>
          </div>

          <div className="mb-4 flex flex-wrap gap-4 text-xs text-slate-600">
            <span>Nodes: {graphData?.nodes.length ?? 0}</span>
            <span>Edges: {graphData?.edges.length ?? 0}</span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-400" />
              Modules
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-violet-400" />
              Test files
            </span>
          </div>

          {graphError && (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {graphError}
            </p>
          )}

          {!indexedRepository ? (
            <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-500">
              Index a repository to visualize its graph.
            </div>
          ) : graphLoading && !graphData ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-600">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Loading graph...
            </div>
          ) : graphData && graphData.nodes.length > 0 ? (
            <>
              <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                <svg
                  viewBox="0 0 800 460"
                  className="h-[360px] w-full sm:h-[460px]"
                  role="img"
                  aria-label="Interactive repository dependency graph"
                >
                  {(() => {
                    const width = 800;
                    const height = 460;
                    const radius = 175;
                    const centerX = width / 2;
                    const centerY = height / 2;
                    const positions = new Map(
                      graphData.nodes.map((node, index) => {
                        const angle =
                          (2 * Math.PI * index) / graphData.nodes.length -
                          Math.PI / 2;

                        return [
                          node.id,
                          {
                            x:
                              graphData.nodes.length === 1
                                ? centerX
                                : centerX + radius * Math.cos(angle),
                            y:
                              graphData.nodes.length === 1
                                ? centerY
                                : centerY + radius * Math.sin(angle),
                          },
                        ];
                      }),
                    );

                    return (
                      <>
                        {graphData.edges.map((edge, index) => {
                          const source = positions.get(edge.source);
                          const target = positions.get(edge.target);

                          if (!source || !target) return null;

                          return (
                            <line
                              key={`${edge.source}-${edge.target}-${index}`}
                              x1={source.x}
                              y1={source.y}
                              x2={target.x}
                              y2={target.y}
                              stroke="#475569"
                              strokeOpacity={0.65}
                              strokeWidth={1.2}
                            />
                          );
                        })}

                        {graphData.nodes.map((node) => {
                          const position = positions.get(node.id);
                          if (!position) return null;

                          const selected = selectedNode?.id === node.id;
                          const color = node.is_test ? "#A78BFA" : "#60A5FA";
                          const shortName = node.id.split("/").pop() ?? node.id;

                          return (
                            <g
                              key={node.id}
                              role="button"
                              tabIndex={0}
                              aria-label={`Select ${node.id}`}
                              onClick={() => {
                                setSelectedNode(selected ? null : node);
                                  setFiles(node.id);
                                  setError("");
                              }}
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
                                  event.preventDefault();
                                  setSelectedNode(selected ? null : node);
                                  setFiles(node.id);
                                  setError("");
                                }
                              }}
                              className="cursor-pointer"
                            >
                              <circle
                                cx={position.x}
                                cy={position.y}
                                r={selected ? 9 : 7}
                                fill={color}
                                stroke={selected ? "#FFFFFF" : color}
                                strokeWidth={selected ? 2 : 1}
                              />
                              <text
                                x={position.x}
                                y={position.y + 19}
                                textAnchor="middle"
                                fill="#CBD5E1"
                                fontSize="10"
                              >
                                {shortName.length > 20
                                  ? `${shortName.slice(0, 17)}...`
                                  : shortName}
                              </text>
                            </g>
                          );
                        })}
                      </>
                    );
                  })()}
                </svg>
              </div>

              {selectedNode && (
                <div className="mt-4 rounded-xl border border-blue-200 bg-blue-400/[0.04] p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-blue-700">
                      Selected {selectedNode.is_test ? "test file" : "module"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedNode(null)}
                      className="text-xs text-slate-600 hover:text-white"
                    >
                      Clear selection
                    </button>
                  </div>
                  <p className="break-all font-mono text-sm text-slate-800">
                    {selectedNode.id}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-slate-200 px-5 text-center text-sm text-slate-500">
              No graph nodes were returned. Check whether the repository was
              indexed successfully.
            </div>
          )}
        </section>


          </>
        )}

        {activePage === "analysis" && (
          <>
        {/* Analysis section */}
        <div className="grid items-start gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          {/* Input panel */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
                <FileCode2 className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold">Analyze code changes</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Enter repository-relative file paths.
                </p>
              </div>
            </div>

            <label
              htmlFor="file-paths"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Changed files
            </label>
            <textarea
              id="file-paths"
              value={files}
              onChange={(event) => setFiles(event.target.value)}
              placeholder={"src/module.py\nsrc/another_module.py"}
              rows={5}
              disabled={!indexedRepository || loading}
              className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-600 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Enter one file path per line. Use paths from the indexed
              repository.
            </p>

            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
              <input
                type="checkbox"
                checked={includeAI}
                onChange={(event) => setIncludeAI(event.target.checked)}
                disabled={loading}
                className="mt-1 h-4 w-4 accent-blue-500"
              />
              <span>
                <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  <Sparkles className="h-4 w-4 text-violet-600" />
                  Include AI analysis
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  Groq combines graph evidence into a prioritized test plan.
                  Recommendations are not proof that tests were executed.
                </span>
              </span>
            </label>

            {error && (
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <button
              type="button"
              onClick={() => void runAnalysis()}
              disabled={loading || indexing || !indexedRepository}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-200/70 transition hover:from-blue-500 hover:to-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Analyzing code...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Run Impact Analysis
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>

            {!indexedRepository && (
              <p className="mt-3 text-center text-xs text-slate-500">
                Index a repository before running analysis.
              </p>
            )}
          </section>

          {/* Results panel */}
          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50">
                <Activity className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <h3 className="font-semibold">Analysis results</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Impact, test recommendations, and AI insights.
                </p>
              </div>
            </div>

            {!result && !loading && (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 px-5 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.03]">
                  <Terminal className="h-6 w-6 text-slate-500" />
                </div>
                <p className="font-medium text-slate-700">No analysis yet</p>
                <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">
                  Index your repository, enter the changed file paths, and run
                  an analysis to see the results.
                </p>
              </div>
            )}

            {loading && (
              <div className="flex min-h-64 flex-col items-center justify-center text-center">
                <LoaderCircle className="mb-4 h-9 w-9 animate-spin text-blue-600" />
                <p className="font-medium text-slate-800">
                  Analyzing code relationships
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  Finding impact and ranking relevant tests...
                </p>
              </div>
            )}

            {result && !loading && (
              <div className="space-y-6">
                {/* Blast radius summary */}
                <div>
                  <div className="mb-4 flex items-center gap-2">
                    <Activity className="h-4 w-4 text-blue-600" />
                    <h4 className="text-sm font-semibold text-slate-800">
                      Blast radius
                    </h4>
                  </div>

                  <div className="mb-4 grid grid-cols-3 gap-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-2xl font-bold text-blue-700">
                        {dependentCount}
                      </p>
                      <p className="mt-1 text-xs leading-4 text-slate-500">
                        Affected modules
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-2xl font-bold text-violet-700">
                        {testsReached}
                      </p>
                      <p className="mt-1 text-xs leading-4 text-slate-500">
                        Related tests
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-2xl font-bold text-amber-700">
                        {directImporterCount}
                      </p>
                      <p className="mt-1 text-xs leading-4 text-slate-500">
                        Direct importers
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {changedFiles.length > 0 ? (
                      changedFiles.map((file) => (
                        <div
                          key={file.file}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                        >
                          <div className="mb-2 flex items-center gap-2">
                            <FileCode2 className="h-4 w-4 shrink-0 text-blue-600" />
                            <span className="text-xs text-slate-500">
                              Changed file
                            </span>
                          </div>
                          <p className="break-all font-mono text-sm text-slate-800">
                            {file.file}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">
                        No impact summary was returned.
                      </p>
                    )}
                  </div>
                </div>

                {/* Ranked tests */}
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Bug className="h-4 w-4 text-violet-600" />
                      <h4 className="text-sm font-semibold text-slate-800">
                        Recommended tests
                      </h4>
                    </div>
                    <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs text-violet-700">
                      {rankedTests.length} found
                    </span>
                  </div>

                  {rankedTests.length > 0 ? (
                    <div className="space-y-3">
                      {rankedTests.map((test, index) => (
                        <div
                          key={`${getTestName(test)}-${index}`}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-xs font-semibold text-blue-700">
                              {index + 1}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="break-all font-mono text-sm text-slate-800">
                                {getTestName(test)}
                              </p>
                              {test.score !== undefined && (
                                <p className="mt-2 text-xs text-blue-700">
                                  Score: {String(test.score)}
                                </p>
                              )}
                              {test.reason && (
                                <p className="mt-2 text-sm leading-6 text-slate-600">
                                  {test.reason}
                                </p>
                              )}

                              {Array.isArray(test.evidence) &&
                                test.evidence.map((item, evidenceIndex) => (
                                  <div
                                    key={`${getTestName(test)}-evidence-${evidenceIndex}`}
                                    className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3"
                                  >
                                    <p className="text-xs font-medium text-violet-700">
                                      {item.type === "imports"
                                        ? `Import relationship · ${item.hops ?? "?"} hop(s)`
                                        : item.type === "co_changed"
                                          ? "Historical co-change"
                                          : item.type ===
                                              "test_file_itself_changed"
                                            ? "Test file changed"
                                            : "Supporting evidence"}
                                    </p>
                                    {item.chain && item.chain.length > 0 && (
                                      <p className="mt-2 break-words text-xs leading-5 text-slate-600">
                                        {item.chain.join(" → ")}
                                      </p>
                                    )}
                                    {item.changed && (
                                      <p className="mt-2 break-all text-xs text-slate-500">
                                        Related file: {item.changed}
                                      </p>
                                    )}
                                    {item.times_changed_together !==
                                      undefined && (
                                      <p className="mt-2 text-xs text-slate-500">
                                        Changed together:{" "}
                                        {item.times_changed_together} times
                                      </p>
                                    )}
                                  </div>
                                ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-500">
                      No ranked tests were returned. Check the backend response
                      or try another file path.
                    </div>
                  )}
                </div>

                {/* AI report */}
                {includeAI && (
                  <div>
                    <div className="mb-3 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-violet-600" />
                      <h4 className="text-sm font-semibold text-slate-800">
                        AI report
                      </h4>
                    </div>

                    {result.ai_report ? (
                      <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-4">
                        {renderAIReport(result.ai_report)}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-500">
                        {result.ai_error ||
                          "No AI report was returned. Check the backend AI configuration."}
                      </div>
                    )}
                  </div>
                )}

                {/* Raw response for debugging */}
                <details className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <summary className="cursor-pointer text-sm font-medium text-slate-700">
                    View complete API response
                  </summary>
                  <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-600">
                    {formatValue(result)}
                  </pre>
                </details>
              </div>
            )}
          </section>
        </div>


          </>
        )}

        {/* Footer */}
        <footer className="mt-12 border-t border-slate-100 pt-6">
          <div className="flex flex-col justify-between gap-3 text-xs text-slate-500 sm:flex-row sm:items-center">
            <p>TestScope — Graph-powered code impact analysis</p>
            <p className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
              FastAPI · FalkorDB · Groq AI
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
