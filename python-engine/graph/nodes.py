"""LangGraph graph nodes for the RPA agent execution engine.

Each node is a function that takes AgentState and returns a partial state update.
Nodes handle: intake classification, manifest planning, step execution,
vision fallback, HITL review, and circuit breaker logic.
"""

from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.types import interrupt, Command

from graph.state import AgentState, TaskManifest, TaskStep, DraftOutput, CircuitBreakerState


def _get_llm(state: AgentState, vision: bool = False) -> ChatGoogleGenerativeAI:
    """Initialize the Gemini LLM from state API key."""
    model = "gemini-2.0-flash" if not vision else "gemini-2.0-flash"
    return ChatGoogleGenerativeAI(
        model=model,
        google_api_key=state["api_key"],
        temperature=0.1,
    )


def _emit(msg_type: str, data: Any) -> None:
    """Emit a JSON message to stdout for the Tauri frontend."""
    import sys
    message = json.dumps({"type": msg_type, "data": data, "timestamp": datetime.now(timezone.utc).isoformat()})
    print(message, flush=True)


# ── Intake & Safety ────────────────────────────────────────────────

def intake_classifier_node(state: AgentState) -> dict:
    """Evaluate user prompt for safety and feasibility.
    
    Routes through the ethical filter before any planning or execution.
    Emits classification result to the frontend.
    """
    _emit("status", {"step": "intake", "message": "Evaluating prompt safety..."})
    
    from guardrails.ethical_filter import evaluate_prompt
    
    result = evaluate_prompt(state["user_prompt"], state["api_key"])
    
    _emit("safety_result", {
        "classification": result["classification"],
        "reason": result["reason"],
    })
    
    return {
        "safety_classification": result["classification"],
        "safety_reason": result["reason"],
        "status": "intake",
        "messages": [{"role": "system", "content": f"Safety classification: {result['classification']} - {result['reason']}"}],
    }


def should_continue_after_intake(state: AgentState) -> str:
    """Routing function: proceed to planning only if prompt is safe."""
    if state["safety_classification"] == "safe":
        return "plan"
    return "reject"


def reject_node(state: AgentState) -> dict:
    """Terminal node for rejected prompts."""
    _emit("rejected", {
        "reason": state["safety_reason"],
        "message": "This request has been rejected by the safety classifier.",
    })
    return {
        "status": "failed",
        "error": f"Prompt rejected: {state['safety_reason']}",
        "messages": [{"role": "assistant", "content": f"⚠️ I cannot process this request. Reason: {state['safety_reason']}"}],
    }


# ── Planning ────────────────────────────────────────────────────────

def planning_node(state: AgentState) -> dict:
    """Generate a structured task manifest from the user prompt.
    
    Uses Gemini to decompose the task into executable steps with
    tool requirements, input/output schemas, and dependency chains.
    """
    _emit("status", {"step": "planning", "message": "Building execution plan..."})
    
    llm = _get_llm(state)
    
    planning_prompt = f"""You are an RPA task planner. Analyze the user's automation request and create a structured execution manifest.

User Request: {state["user_prompt"]}

You must respond with a valid JSON object (no markdown fencing) with this exact structure:
{{
    "task_id": "<uuid>",
    "title": "<short title>",
    "description": "<detailed description>",
    "tools_required": [
        {{"name": "browser|filesystem|vision|gemini", "parameters": {{}}, "description": ""}}
    ],
    "steps": [
        {{
            "step_id": "<uuid>",
            "action": "<human-readable description>",
            "tool": "browser|filesystem|vision|gemini",
            "parameters": {{}},
            "depends_on": []
        }}
    ],
    "input_schema": {{}},
    "output_schema": {{}},
    "estimated_duration_seconds": 60,
    "requires_browser": false,
    "requires_filesystem": false
}}

Rules:
- Each step should be atomic and independently executable
- Use "browser" tool for web automation tasks
- Use "filesystem" tool for local file operations  
- Use "vision" tool for visual element location
- Use "gemini" tool for text generation/analysis
- Always end with a step that produces a draft output for human review
- Keep step count reasonable (under 15 steps)
"""
    
    response = llm.invoke(planning_prompt)
    
    try:
        manifest_text = response.content.strip()
        if manifest_text.startswith("```"):
            manifest_text = manifest_text.split("\n", 1)[1].rsplit("```", 1)[0]
        manifest_dict = json.loads(manifest_text)
        manifest_dict["task_id"] = str(uuid.uuid4())
        for step in manifest_dict.get("steps", []):
            if not step.get("step_id"):
                step["step_id"] = str(uuid.uuid4())
            step["status"] = "pending"
            step["retry_count"] = 0
            step["max_retries"] = 3
    except (json.JSONDecodeError, KeyError) as e:
        _emit("error", {"message": f"Failed to parse manifest: {e}"})
        return {
            "status": "failed",
            "error": f"Manifest generation failed: {e}",
            "messages": [{"role": "system", "content": f"Planning error: {e}"}],
        }
    
    _emit("manifest", manifest_dict)
    
    return {
        "manifest": manifest_dict,
        "current_step_index": 0,
        "status": "planning",
        "circuit_breakers": {},
        "messages": [{"role": "assistant", "content": f"📋 Execution plan created: {manifest_dict['title']} ({len(manifest_dict['steps'])} steps)"}],
    }


# ── Execution ───────────────────────────────────────────────────────

def execution_node(state: AgentState) -> dict:
    """Execute the current step in the task manifest.
    
    Delegates to the appropriate tool (browser, filesystem, vision, gemini)
    based on the step's tool field. Implements circuit breaker logic.
    """
    manifest = state["manifest"]
    step_index = state["current_step_index"]
    steps = manifest.get("steps", [])
    
    if step_index >= len(steps):
        return {"status": "review", "messages": [{"role": "system", "content": "All steps completed. Moving to review."}]}
    
    step = steps[step_index]
    step_id = step["step_id"]
    
    # Circuit breaker check
    breakers = state.get("circuit_breakers", {})
    breaker = breakers.get(step_id, {"attempt_count": 0, "max_attempts": 3, "started_at": None, "max_duration_seconds": 300, "is_tripped": False})
    
    if breaker.get("is_tripped", False):
        _emit("circuit_breaker", {"step_id": step_id, "message": "Circuit breaker tripped. Skipping step."})
        step["status"] = "skipped"
        return {
            "manifest": manifest,
            "current_step_index": step_index + 1,
            "messages": [{"role": "system", "content": f"⚡ Circuit breaker tripped for step: {step['action']}"}],
        }
    
    if breaker["started_at"] is None:
        breaker["started_at"] = datetime.now(timezone.utc).isoformat()
    
    _emit("status", {"step": "executing", "message": f"Step {step_index + 1}/{len(steps)}: {step['action']}", "step_id": step_id})
    
    step["status"] = "running"
    
    try:
        tool = step["tool"]
        result = {}
        
        if tool == "browser":
            from tools.browser import execute_browser_step
            result = execute_browser_step(step, state)
        elif tool == "filesystem":
            from tools.os_files import execute_filesystem_step
            result = execute_filesystem_step(step, state)
        elif tool == "vision":
            from tools.vision_fallback import execute_vision_step
            result = execute_vision_step(step, state)
        elif tool == "gemini":
            result = _execute_gemini_step(step, state)
        else:
            raise ValueError(f"Unknown tool: {tool}")
        
        step["status"] = "completed"
        step["result"] = result
        
        _emit("step_complete", {"step_id": step_id, "result": result})
        
        return {
            "manifest": manifest,
            "current_step_index": step_index + 1,
            "execution_results": [{"step_id": step_id, "status": "completed", "result": result}],
            "messages": [{"role": "system", "content": f"✅ Step completed: {step['action']}"}],
        }
        
    except Exception as e:
        breaker["attempt_count"] = breaker.get("attempt_count", 0) + 1
        
        # Check if circuit breaker should trip
        if breaker["attempt_count"] >= breaker["max_attempts"]:
            breaker["is_tripped"] = True
            _emit("circuit_breaker", {"step_id": step_id, "message": f"Max retries exceeded: {e}"})
        elif breaker.get("started_at"):
            elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(breaker["started_at"])).total_seconds()
            if elapsed > breaker["max_duration_seconds"]:
                breaker["is_tripped"] = True
                _emit("circuit_breaker", {"step_id": step_id, "message": f"Timeout exceeded: {elapsed}s"})
        
        step["status"] = "failed"
        step["error"] = str(e)
        step["retry_count"] = breaker["attempt_count"]
        
        breakers[step_id] = breaker
        
        if breaker["is_tripped"]:
            return {
                "manifest": manifest,
                "current_step_index": step_index + 1,
                "circuit_breakers": breakers,
                "execution_results": [{"step_id": step_id, "status": "failed", "error": str(e)}],
                "messages": [{"role": "system", "content": f"❌ Step failed (circuit breaker tripped): {step['action']} - {e}"}],
            }
        
        # Retry: don't advance step index
        _emit("retry", {"step_id": step_id, "attempt": breaker["attempt_count"], "error": str(e)})
        return {
            "manifest": manifest,
            "circuit_breakers": breakers,
            "execution_results": [{"step_id": step_id, "status": "retrying", "error": str(e), "attempt": breaker["attempt_count"]}],
            "messages": [{"role": "system", "content": f"🔄 Retrying step ({breaker['attempt_count']}/{breaker['max_attempts']}): {step['action']}"}],
        }


def _execute_gemini_step(step: dict, state: AgentState) -> dict:
    """Execute a Gemini LLM step for text generation or analysis."""
    llm = _get_llm(state)
    
    prompt = step.get("parameters", {}).get("prompt", step["action"])
    context = step.get("parameters", {}).get("context", "")
    
    full_prompt = f"{prompt}\n\nContext:\n{context}" if context else prompt
    
    response = llm.invoke(full_prompt)
    
    return {
        "content": response.content,
        "model": "gemini-2.0-flash",
        "usage": {},
    }


def should_continue_execution(state: AgentState) -> str:
    """Route: continue executing steps or move to review."""
    manifest = state.get("manifest", {})
    steps = manifest.get("steps", [])
    current = state.get("current_step_index", 0)
    
    if current >= len(steps):
        return "review"
    return "execute"


# ── HITL Review ─────────────────────────────────────────────────────

def review_node(state: AgentState) -> dict:
    """Prepare draft output and pause for human review.
    
    Uses LangGraph's interrupt() to pause execution and wait for
    human approval or change requests via the frontend modal.
    """
    _emit("status", {"step": "review", "message": "Preparing draft for review..."})
    
    # Collect all execution results into a draft
    results = state.get("execution_results", [])
    manifest = state.get("manifest", {})
    
    # Build draft content from results
    draft_content = ""
    for r in results:
        if r.get("result") and r["result"].get("content"):
            draft_content += r["result"]["content"] + "\n\n"
    
    if not draft_content.strip():
        draft_content = json.dumps(results, indent=2)
    
    draft = {
        "draft_id": str(uuid.uuid4()),
        "file_type": "text",
        "content": draft_content.strip(),
        "filename": f"{manifest.get('title', 'output').replace(' ', '_').lower()}.txt",
        "metadata": {"task_id": manifest.get("task_id", ""), "steps_completed": len(results)},
        "revision": 1,
        "feedback_history": [],
    }
    
    _emit("hitl_pause", draft)
    
    # This interrupt pauses the graph and waits for human input
    human_response = interrupt({"draft": draft, "message": "Please review the draft output."})
    
    return {
        "draft_output": draft,
        "human_decision": human_response.get("decision"),  # "approve" or "revise"
        "human_feedback": human_response.get("feedback", ""),
        "status": "review",
        "messages": [{"role": "system", "content": f"Human decision: {human_response.get('decision')}"}],
    }


def should_continue_after_review(state: AgentState) -> str:
    """Route: finalize approved output or process revision feedback."""
    decision = state.get("human_decision")
    if decision == "approve":
        return "finalize"
    return "revise"


def revision_node(state: AgentState) -> dict:
    """Process human feedback and generate an incremental revision.
    
    Sends only the modified sections back to Gemini to conserve
    token window depth (incremental diff updates).
    """
    _emit("status", {"step": "revising", "message": "Processing feedback..."})
    
    llm = _get_llm(state)
    draft = state.get("draft_output", {})
    feedback = state.get("human_feedback", "")
    
    revision_prompt = f"""You are revising a document based on user feedback.

CURRENT DRAFT:
{draft.get('content', '')}

USER FEEDBACK:
{feedback}

Please provide the COMPLETE revised document incorporating the feedback.
Only modify the sections that the feedback addresses. Keep everything else unchanged.
Respond with just the revised content, no explanations."""
    
    response = llm.invoke(revision_prompt)
    
    updated_draft = dict(draft)
    updated_draft["content"] = response.content
    updated_draft["revision"] = draft.get("revision", 1) + 1
    feedback_history = list(draft.get("feedback_history", []))
    feedback_history.append(feedback)
    updated_draft["feedback_history"] = feedback_history
    
    _emit("draft_updated", updated_draft)
    
    # Pause again for review of the revision
    human_response = interrupt({"draft": updated_draft, "message": f"Revision {updated_draft['revision']} ready for review."})
    
    return {
        "draft_output": updated_draft,
        "human_decision": human_response.get("decision"),
        "human_feedback": human_response.get("feedback", ""),
        "messages": [{"role": "system", "content": f"Revision {updated_draft['revision']} submitted. Decision: {human_response.get('decision')}"}],
    }


def finalize_node(state: AgentState) -> dict:
    """Finalize the approved output and save results."""
    _emit("status", {"step": "finalizing", "message": "Saving approved output..."})
    
    draft = state.get("draft_output", {})
    
    _emit("completed", {
        "draft": draft,
        "message": "Task completed successfully.",
    })
    
    return {
        "final_output": draft,
        "status": "completed",
        "messages": [{"role": "assistant", "content": f"✅ Task completed. Output saved as: {draft.get('filename', 'output.txt')}"}],
    }
