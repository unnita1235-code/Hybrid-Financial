import os
import sys
import pytest
from types import SimpleNamespace

# Ensure the apps directory is in the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../apps/server')))

from app.main import configure_langsmith

@pytest.fixture(autouse=True)
def clean_env():
    keys = ["LANGCHAIN_TRACING_V2", "LANGCHAIN_API_KEY", "LANGCHAIN_PROJECT", "LANGCHAIN_ENDPOINT"]
    for k in keys:
        os.environ.pop(k, None)
    yield
    for k in keys:
        os.environ.pop(k, None)

def test_configure_langsmith_sets_env_when_enabled():
    mock_settings = SimpleNamespace(
        langsmith_tracing=True,
        langsmith_api_key="ls__test",
        langsmith_project="test-project"
    )
    configure_langsmith(mock_settings)

    assert os.environ.get("LANGCHAIN_TRACING_V2") == "true"
    assert os.environ.get("LANGCHAIN_API_KEY") == "ls__test"
    assert os.environ.get("LANGCHAIN_PROJECT") == "test-project"
    assert os.environ.get("LANGCHAIN_ENDPOINT") == "https://api.smith.langchain.com"

def test_configure_langsmith_does_not_set_env_when_disabled():
    mock_settings = SimpleNamespace(
        langsmith_tracing=False,
        langsmith_api_key="ls__test",
        langsmith_project="test-project"
    )
    configure_langsmith(mock_settings)

    assert "LANGCHAIN_TRACING_V2" not in os.environ
