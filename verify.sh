#!/bin/bash

echo "=== BLOCK 1A ==="
ls -la packages/ai-core/aequitas_ai/rag_engine.py && wc -l packages/ai-core/aequitas_ai/rag_engine.py || echo "FILE NOT FOUND"
echo "=== BLOCK 1B ==="
grep -n "retrieve_hybrid\|rrf_k\|fts_rpc\|match_rag_chunks_fts\|def.*rrf\|reciprocal_rank" packages/ai-core/aequitas_ai/rag_engine.py || echo "RESULT: retrieve_hybrid METHOD NOT FOUND — TASK 1 INCOMPLETE"
echo "=== BLOCK 1C ==="
ls -la packages/database/alembic/versions/006_fts_rpc.py 2>&1 && grep -n "match_rag_chunks_fts\|plainto_tsquery\|def upgrade" packages/database/alembic/versions/006_fts_rpc.py || echo "RESULT: 006_fts_rpc.py NOT FOUND — TASK 1 MIGRATION INCOMPLETE"
echo "=== BLOCK 1D ==="
python -m pytest packages/ai-core/tests/test_rrf.py -v --tb=long 2>&1

echo "=== BLOCK 2A ==="
grep -n "deepeval\|continue-on-error\|HAS_KEY\|deepeval-required\|deepeval-optional" .github/workflows/ai-pipeline.yml || echo "SINGLE JOB ONLY — TASK 2 INCOMPLETE"
echo "=== BLOCK 2B ==="
grep -n "threshold" testing_suite/test_deepeval_sql_rag.py || echo "RESULT: THRESHOLD NOT UPDATED — TASK 2 INCOMPLETE"
echo "=== BLOCK 2C ==="
OPENAI_API_KEY="" python -m pytest testing_suite/test_deepeval_sql_rag.py -v 2>&1

echo "=== BLOCK 3A ==="
grep -n "scaffold\|stub\|ready for full toolchain\|market_value.*sum\|sum.*market_value" packages/ai-core/aequitas_ai/agents/portfolio_agent.py || echo "CLEAR"
echo "=== BLOCK 3B ==="
grep -n "StateGraph\|add_node\|add_edge\|BaseChatModel\|concentration\|PortfolioAgentConfig" packages/ai-core/aequitas_ai/agents/portfolio_agent.py || echo "RESULT: NO LANGGRAPH NODES FOUND — TASK 3 INCOMPLETE"
echo "=== BLOCK 3C ==="
python -m pytest packages/ai-core/tests/test_portfolio_agent.py -v --tb=long 2>&1 || echo "RESULT: test_portfolio_agent.py NOT FOUND — TASK 3 INCOMPLETE"
echo "=== BLOCK 3D ==="
python -c "
from aequitas_ai.agents.portfolio_agent import build_portfolio_agent
try:
    build_portfolio_agent()
    print('FAIL: should have raised NotImplementedError')
except NotImplementedError as e:
    print(f'PASS: raised NotImplementedError: {e}')
except TypeError as e:
    print(f'AMBIGUOUS: raised TypeError: {e}')
" 2>&1

echo "=== BLOCK 4A ==="
grep -n "stub\|0\.0\|source.*stub\|price.*0" packages/ai-core/aequitas_ai/tools/market_data.py || echo "CLEAR"
echo "=== BLOCK 4B ==="
grep -n "yahoo\|query1.finance.yahoo\|regularMarketPrice\|MarketDataResult\|AsyncSession" packages/ai-core/aequitas_ai/tools/market_data.py || echo "RESULT: NO YAHOO INTEGRATION FOUND — TASK 4 INCOMPLETE"
echo "=== BLOCK 4C ==="
python -c "
import inspect, asyncio
from aequitas_ai.tools.market_data import fetch_market_price
sig = inspect.signature(fetch_market_price)
print('Parameters:', list(sig.parameters.keys()))
hints = fetch_market_price.__annotations__
print('Annotations:', hints)
" 2>&1
echo "=== BLOCK 4D ==="
python -m pytest packages/ai-core/tests/test_market_data_tool.py -v --tb=long 2>&1

echo "=== BLOCK 5A ==="
grep -n "Stub filing\|stub\|return.*stub" packages/ai-core/aequitas_ai/tools/filing_search.py || echo "CLEAR"
echo "=== BLOCK 5B ==="
grep -n "efts.sec.gov\|edgar\|FilingResult\|accession_no\|User-Agent\|plainto_tsquery" packages/ai-core/aequitas_ai/tools/filing_search.py || echo "RESULT: NO EDGAR INTEGRATION — TASK 5 INCOMPLETE"
echo "=== BLOCK 5C ==="
grep -n "User-Agent\|Aequitas-FI\|academic" packages/ai-core/aequitas_ai/tools/filing_search.py || echo "RESULT: USER-AGENT HEADER MISSING — SEC TERMS VIOLATION — TASK 5 INCOMPLETE"
echo "=== BLOCK 5D ==="
python -m pytest packages/ai-core/tests/test_filing_search.py -v --tb=long 2>&1

echo "=== BLOCK 6A ==="
grep -n "langsmith\|LANGCHAIN_TRACING\|langsmith_project\|langsmith_api_key" apps/server/app/config.py || echo "RESULT: LANGSMITH FIELDS NOT IN CONFIG — TASK 6 INCOMPLETE"
echo "=== BLOCK 6B ==="
grep -n "configure_langsmith\|LANGCHAIN_TRACING_V2\|LANGCHAIN_API_KEY\|LANGCHAIN_PROJECT" apps/server/app/main.py || echo "RESULT: FUNCTION NOT IN MAIN.PY — TASK 6 INCOMPLETE"
echo "=== BLOCK 6C ==="
grep -n "LANGSMITH\|langsmith" apps/server/.env.example || echo "RESULT: ENV EXAMPLE NOT UPDATED — TASK 6 INCOMPLETE"
echo "=== BLOCK 6D ==="
python -m pytest testing_suite/test_langsmith_config.py -v --tb=long 2>&1

echo "=== BLOCK 7A ==="
grep -n "scaffold\|stub\|ready for full toolchain wiring\|status.*ok" packages/ai-core/aequitas_ai/agents/research_agent.py || echo "CLEAR"
echo "=== BLOCK 7B ==="
grep -n "from aequitas_ai.research_agent import\|__all__" packages/ai-core/aequitas_ai/agents/research_agent.py || echo "RESULT: RE-EXPORT NOT IMPLEMENTED — TASK 7 INCOMPLETE"
echo "=== BLOCK 7C ==="
python -c "
# Test all three import paths simultaneously
results = []

try:
    from aequitas_ai.agents.research_agent import build_research_agent as a
    results.append('agents.research_agent: OK')
except ImportError as e:
    results.append(f'agents.research_agent: FAIL — {e}')

try:
    from aequitas_ai import build_research_agent as b
    results.append('aequitas_ai top-level: OK')
except ImportError as e:
    results.append(f'aequitas_ai top-level: FAIL — {e}')

try:
    from aequitas_ai.research_agent import StubResearchConfig
    results.append('StubResearchConfig: OK')
except ImportError as e:
    results.append(f'StubResearchConfig: FAIL — {e}')

for r in results:
    print(r)
" 2>&1
echo "=== BLOCK 7D ==="
python -m pytest packages/ai-core/tests/test_research_agent_imports.py -v --tb=long 2>&1

echo "=== BLOCK 8A ==="
python -m pytest packages/ai-core/tests/ testing_suite/ -v --tb=short -m "not requires_llm" 2>&1 | tail -40
echo "=== BLOCK 8B ==="
python -c "
checks = []

imports = [
    ('rag_engine', 'from aequitas_ai import SupabaseRagRetriever, build_hybrid_sources'),
    ('sql_engine', 'from aequitas_ai import build_sql_engine_graph'),
    ('research_agent', 'from aequitas_ai import build_research_agent, to_research_output_ui'),
    ('portfolio_agent', 'from aequitas_ai.agents.portfolio_agent import build_portfolio_agent'),
    ('market_data', 'from aequitas_ai.tools.market_data import fetch_market_price'),
    ('filing_search', 'from aequitas_ai.tools.filing_search import search_filings'),
    ('langsmith_cfg', 'from app.main import configure_langsmith'),
]

for name, stmt in imports:
    try:
        exec(stmt)
        checks.append(f'PASS  {name}')
    except Exception as e:
        checks.append(f'FAIL  {name}: {e}')

for c in checks:
    print(c)

failed = [c for c in checks if c.startswith('FAIL')]
print()
print(f'Result: {len(checks)-len(failed)}/{len(checks)} imports OK')
if failed:
    print('FAILED IMPORTS DETECTED — INTEGRATION INCOMPLETE')
else:
    print('ALL IMPORTS OK')
" 2>&1
echo "=== BLOCK 8C ==="
python testing_suite/verify_no_api_keys.py 2>&1 || echo "CREDENTIAL LEAK DETECTED"
echo "=== BLOCK 8D ==="
python testing_suite/calculate_faithfulness.py --demo 2>&1
