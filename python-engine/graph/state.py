"""LangGraph state schema for the RPA Agent execution engine.

Defines the structured state that flows through the agent graph,
including task manifests, execution context, and HITL checkpoints.
"""

from __future__ import annotations
import operator
from typing import Annotated, Any, Literal, Optional, Sequence
from pydantic import BaseModel, Field
from typing_extensions import TypedDict


class ToolRequirement(BaseModel):
    """A tool required for task execution."""
    name: str = Field(description="Tool identifier (browser, filesystem, vision)")
    parameters: dict[str, Any] = Field(default_factory=dict)
    description: str = ""


class TaskStep(BaseModel):
    """A single step in the execution plan."""
    step_id: str
    action: str = Field(description="Human-readable action description")
    tool: str = Field(description="Tool to use: browser | filesystem | vision | gemini")
    parameters: dict[str, Any] = Field(default_factory=dict)
    depends_on: list[str] = Field(default_factory=list)
    status: Literal["pending", "running", "completed", "failed", "skipped"] = "pending"
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None
    retry_count: int = 0
    max_retries: int = 3


class TaskManifest(BaseModel):
    """Structured execution manifest generated from user prompt."""
    task_id: str
    title: str
    description: str
    tools_required: list[ToolRequirement] = Field(default_factory=list)
    steps: list[TaskStep] = Field(default_factory=list)
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    estimated_duration_seconds: int = 0
    requires_browser: bool = False
    requires_filesystem: bool = False


class DraftOutput(BaseModel):
    """A draft output awaiting human review."""
    draft_id: str
    file_type: Literal["pdf", "text", "csv", "json"]
    content: str
    filename: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    revision: int = 1
    feedback_history: list[str] = Field(default_factory=list)


class CircuitBreakerState(BaseModel):
    """Circuit breaker tracking for self-healing retry loops."""
    step_id: str
    attempt_count: int = 0
    max_attempts: int = 3
    started_at: Optional[str] = None
    max_duration_seconds: int = 300  # 5 minutes
    is_tripped: bool = False


# -- LangGraph State (TypedDict for graph compatibility) --

class AgentState(TypedDict):
    """Root state flowing through the LangGraph agent graph.
    
    Uses Annotated reducers for message accumulation.
    """
    # User input
    user_prompt: str
    api_key: str
    
    # Safety classification
    safety_classification: Literal["safe", "unsafe", "pending"]  
    safety_reason: str
    
    # Task planning
    manifest: Optional[dict]  # Serialized TaskManifest
    
    # Execution tracking
    current_step_index: int
    execution_results: Annotated[list[dict], operator.add]
    
    # Browser automation state
    browser_session_id: Optional[str]
    current_url: Optional[str]
    page_content: Optional[str]
    screenshot_base64: Optional[str]
    
    # HITL review
    draft_output: Optional[dict]  # Serialized DraftOutput
    human_feedback: Optional[str]
    human_decision: Optional[str]  # "approve" | "revise" | None
    
    # Circuit breaker
    circuit_breakers: dict[str, dict]  # step_id -> CircuitBreakerState dict
    
    # Messaging
    messages: Annotated[Sequence[dict], operator.add]
    
    # Terminal state
    final_output: Optional[dict]
    error: Optional[str]
    status: str  # "intake" | "planning" | "executing" | "review" | "completed" | "failed"
