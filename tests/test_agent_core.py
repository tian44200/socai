from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from core.agent import Backend, LLMResponse, Tool, ToolCall, ToolContext, run_agent


class EchoTool(Tool):
    @property
    def name(self) -> str:
        return "echo"

    @property
    def description(self) -> str:
        return "Echo input text."

    @property
    def parameters(self) -> dict:
        return {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        }

    async def execute(self, params: dict, ctx: ToolContext) -> str:
        return f"echo:{params.get('text', '')}"


class FakeBackend(Backend):
    def __init__(self) -> None:
        self.calls = 0
        self.model = "fake-model"

    def create_message(self, *, system: str, messages: list[dict], tools: list[dict], max_tokens: int = 8192):
        self.calls += 1
        if self.calls == 1:
            return LLMResponse(
                text_blocks=["I will call echo."],
                tool_calls=[ToolCall(id="call_1", name="echo", input={"text": "hello"})],
                stop_reason="tool_use",
            )
        return LLMResponse(text_blocks=["done after echo"], tool_calls=[], stop_reason="end_turn")

    def format_assistant_content(self, response: LLMResponse) -> object:
        content = [{"type": "text", "text": text} for text in response.text_blocks]
        content.extend(
            {"type": "tool_use", "id": call.id, "name": call.name, "input": call.input}
            for call in response.tool_calls
        )
        return content

    def format_tool_results(self, tool_calls: list[ToolCall], results: list[list[dict]]) -> dict:
        content = []
        for call, result in zip(tool_calls, results):
            content.append({"type": "tool_result", "tool_use_id": call.id, "content": result})
        return {"role": "user", "content": content}


class AgentCoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_agent_executes_injected_tool(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = await run_agent(
                "echo hello",
                backend=FakeBackend(),
                tools=[EchoTool()],
                run_dir=Path(tmp),
                max_turns=3,
            )

            self.assertEqual(result["result"], "done after echo")
            self.assertEqual(result["turns"], 2)
            self.assertTrue((Path(tmp) / "report.md").is_file())
            self.assertTrue((Path(tmp) / "agent_log.json").is_file())
            self.assertTrue((Path(tmp) / "run_state" / "events.jsonl").is_file())


if __name__ == "__main__":
    unittest.main()
