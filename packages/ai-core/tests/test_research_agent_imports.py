def test_build_research_agent_importable_from_agents_subpackage():
    from aequitas_ai.agents.research_agent import build_research_agent
    assert callable(build_research_agent)

def test_build_research_agent_importable_from_top_level():
    from aequitas_ai import build_research_agent
    assert callable(build_research_agent)

def test_stub_config_builds_graph():
    from aequitas_ai.research_agent import StubResearchConfig
    from unittest.mock import MagicMock
    stub = StubResearchConfig(
        plan_llm=MagicMock(),
        synthesize_llm=MagicMock(),
    )
    config = stub.to_agent_config()
    from aequitas_ai.research_agent import build_research_agent
    graph = build_research_agent(config)
    assert hasattr(graph, "ainvoke")
