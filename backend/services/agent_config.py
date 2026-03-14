# Agent 显示名称等配置的持久化存储服务
import json
from pathlib import Path


class AgentConfigStore:
    """读写 ~/.config/claudemaster/agents.json，持久化 agent 显示名称等配置。"""

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or Path.home() / ".config" / "claudemaster" / "agents.json"

    def _load(self) -> dict[str, dict]:
        if not self._path.exists():
            return {}
        try:
            return json.loads(self._path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}

    def _save(self, data: dict[str, dict]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def get_display_name(self, agent_id: str) -> str | None:
        """返回已保存的 display_name，未找到则返回 None。"""
        entry = self._load().get(agent_id)
        if entry is None:
            return None
        return entry.get("display_name")

    def set_display_name(self, agent_id: str, name: str) -> None:
        """保存 agent 的 display_name。"""
        data = self._load()
        data.setdefault(agent_id, {})["display_name"] = name
        self._save(data)

    def get_all(self) -> dict[str, dict]:
        """返回所有 agent 配置。"""
        return self._load()
