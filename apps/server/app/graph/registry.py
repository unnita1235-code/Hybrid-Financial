"""Central registry for named graph entrypoints."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

GraphFactory = Callable[[], Any]


@dataclass(slots=True)
class GraphRegistry:
    _factories: dict[str, GraphFactory] = field(default_factory=dict)

    def register(self, name: str, factory: GraphFactory) -> None:
        self._factories[name] = factory

    def has(self, name: str) -> bool:
        return name in self._factories

    def list(self) -> list[str]:
        return sorted(self._factories.keys())

    def resolve(self, name: str) -> Any:
        if name not in self._factories:
            raise KeyError(f"Graph '{name}' is not registered")
        return self._factories[name]()
