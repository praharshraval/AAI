"""LangGraph RPA Agent Execution Engine - Sidecar Entrypoint.

This module serves as the main entry point for the Python sidecar process.
It communicates with the Tauri frontend via JSON messages over stdin/stdout.

Protocol:
- Input (stdin): JSON objects with { "type": "...", "data": {...} }
- Output (stdout): JSON objects with { "type": "...", "data": {...}, "timestamp": "..." }

Message Types (Input):
- "start": Begin a new agent execution with { "prompt": "...", "api_key": "..." }
- "resume": Resume a paused execution with { "thread_id": "...", "decision": "approve"|"revise", "feedback": "..." }
- "cancel": Cancel the current execution with { "thread_id": "..." }

Message Types (Output):
- "status": Execution status update
- "safety_result": Ethical classifier result
- "manifest": Generated task manifest
- "step_complete": Individual step result
- "hitl_pause": Execution paused for human review
- "draft_updated": Updated draft after revision
- "completed": Execution completed successfully
- "error": Error occurred
- "rejected": Prompt rejected by safety classifier
- "retry": Step retry notification
- "circuit_breaker": Circuit breaker notification
"""

from __future__ import annotations

import json
import os
import sys
import traceback
import uuid
from datetime import datetime, timezone

# Ensure python-engine directory is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from langgraph.graph import StateGraph, END
from langgraph.types import Command

from graph.state import AgentState
from graph.checkpointer import SQLiteCheckpointer
from graph.nodes import (
    intake_classifier_node,
    should_continue_after_intake,
    planning_node,
    execution_node,
    should_continue_execution,
    review_node,
    should_continue_after_review,
    revision_node,
    finalize_node,
    reject_node,
)


def _emit(msg_type: str, data: dict) -> None:
    """Emit a JSON message to stdout for the Tauri frontend."""
    message = json.dumps({
        "type": msg_type,
        "data": data,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    print(message, flush=True)


def build_graph() -> StateGraph:
    """Construct the LangGraph agent execution graph.
    
    Graph topology:
    
        intake_classifier
             │
        ┌────┴────┐
        │         │
      (safe)   (unsafe)
        │         │
      plan      reject ──► END
        │
      execute ◄──┐
        │        │
        ├── (more steps)
        │
      review
        │
    ┌───┴───┐
    │       │
  approve  revise
    │       │
  finalize  revision ──► review
    │
   END
    """
    graph = StateGraph(AgentState)
    
    # Add nodes
    graph.add_node("intake_classifier", intake_classifier_node)
    graph.add_node("reject", reject_node)
    graph.add_node("plan", planning_node)
    graph.add_node("execute", execution_node)
    graph.add_node("review", review_node)
    graph.add_node("revise", revision_node)
    graph.add_node("finalize", finalize_node)
    
    # Set entry point
    graph.set_entry_point("intake_classifier")
    
    # Add edges
    graph.add_conditional_edges(
        "intake_classifier",
        should_continue_after_intake,
        {"plan": "plan", "reject": "reject"},
    )
    
    graph.add_edge("reject", END)
    graph.add_edge("plan", "execute")
    
    graph.add_conditional_edges(
        "execute",
        should_continue_execution,
        {"execute": "execute", "review": "review"},
    )
    
    graph.add_conditional_edges(
        "review",
        should_continue_after_review,
        {"finalize": "finalize", "revise": "revise"},
    )
    
    # Revision loops back to review
    graph.add_conditional_edges(
        "revise",
        should_continue_after_review,
        {"finalize": "finalize", "revise": "revise"},
    )
    
    graph.add_edge("finalize", END)
    
    return graph


def main():
    """Main sidecar loop: read commands from stdin, execute graph, write results to stdout."""
    _emit("status", {"step": "init", "message": "Python engine initialized and ready"})
    
    checkpointer = SQLiteCheckpointer()
    graph = build_graph()
    compiled_graph = graph.compile(checkpointer=checkpointer)
    
    # Active thread tracking
    active_threads: dict[str, dict] = {}
    
    # Optional CLI args support
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", type=str, default=None)
    parser.add_argument("--api-key", type=str, default=None)
    cli_args, _ = parser.parse_known_args()
    
    def run_start(prompt: str, api_key: str, thread_id: str | None = None):
        nonlocal active_threads
        tid = thread_id or str(uuid.uuid4())
        
        _emit("status", {
            "step": "starting",
            "message": f"Starting agent execution (thread: {tid})",
            "thread_id": tid,
        })
        
        initial_state: AgentState = {
            "user_prompt": prompt,
            "api_key": api_key,
            "safety_classification": "pending",
            "safety_reason": "",
            "manifest": None,
            "current_step_index": 0,
            "execution_results": [],
            "browser_session_id": None,
            "current_url": None,
            "page_content": None,
            "screenshot_base64": None,
            "draft_output": None,
            "human_feedback": None,
            "human_decision": None,
            "circuit_breakers": {},
            "messages": [],
            "final_output": None,
            "error": None,
            "status": "intake",
        }
        
        config = {"configurable": {"thread_id": tid}}
        active_threads[tid] = config
        
        try:
            for _ in compiled_graph.stream(initial_state, config=config):
                pass
        except Exception as graph_error:
            error_name = type(graph_error).__name__.lower()
            if "interrupt" in error_name or "graphinterrupt" in error_name:
                _emit("status", {
                    "step": "paused",
                    "message": "Awaiting human review in HITL modal",
                    "thread_id": tid,
                })
            else:
                raise
    
    # If prompt & api_key passed via CLI, start right away
    if cli_args.prompt and cli_args.api_key:
        try:
            run_start(cli_args.prompt, cli_args.api_key)
        except Exception as e:
            _emit("error", {"message": str(e), "traceback": traceback.format_exc()})
    
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as e:
            _emit("error", {"message": f"Invalid JSON input: {e}"})
            continue
        
        msg_type = msg.get("type", "")
        data = msg.get("data", {})
        
        # Support flat message shapes like {"action": "approve"} or {"action": "request_changes", "feedback": "..."}
        if "action" in msg and not msg_type:
            msg_type = "resume"
            data = {
                "decision": "approve" if msg.get("action") == "approve" else "revise",
                "feedback": msg.get("feedback", ""),
                "thread_id": msg.get("thread_id", ""),
            }
        elif msg_type == "start" and not data and "prompt" in msg:
            data = msg
        
        try:
            if msg_type == "start":
                # Begin a new agent execution
                thread_id = data.get("thread_id")
                prompt = data.get("prompt", "")
                api_key = data.get("api_key", "")
                
                if not prompt:
                    _emit("error", {"message": "Missing 'prompt' in start message"})
                    continue
                
                if not api_key:
                    _emit("error", {"message": "Missing 'api_key' in start message. Configure Gemini API key in Settings."})
                    continue
                
                run_start(prompt, api_key, thread_id)
            
            elif msg_type == "resume":
                # Resume a paused execution with human feedback
                thread_id = data.get("thread_id", "") or (list(active_threads.keys())[-1] if active_threads else "")
                action = data.get("action")
                raw_decision = data.get("decision")
                if action == "approve" or raw_decision == "approve":
                    decision = "approve"
                else:
                    decision = "revise"
                feedback = data.get("feedback", "")
                
                if not thread_id:
                    _emit("error", {"message": "No active thread to resume."})
                    continue
                
                if thread_id not in active_threads:
                    active_threads[thread_id] = {"configurable": {"thread_id": thread_id}}
                
                config = active_threads[thread_id]
                
                _emit("status", {
                    "step": "resuming",
                    "message": f"Resuming execution with decision: {decision}",
                    "thread_id": thread_id,
                })
                
                # Resume the graph with the human response Command
                resume_input = Command(resume={"decision": decision, "feedback": feedback})
                
                try:
                    for _ in compiled_graph.stream(resume_input, config=config):
                        pass
                except Exception as graph_error:
                    error_name = type(graph_error).__name__.lower()
                    if "interrupt" in error_name or "graphinterrupt" in error_name:
                        _emit("status", {
                            "step": "paused",
                            "message": "Awaiting human review in HITL modal",
                            "thread_id": thread_id,
                        })
                    else:
                        raise
            
            elif msg_type == "cancel":
                thread_id = data.get("thread_id", "")
                if thread_id in active_threads:
                    del active_threads[thread_id]
                _emit("status", {
                    "step": "cancelled",
                    "message": "Execution cancelled by user",
                    "thread_id": thread_id,
                })
            
            else:
                _emit("error", {"message": f"Unknown message type: {msg_type}"})
        
        except Exception as e:
            _emit("error", {
                "message": str(e),
                "traceback": traceback.format_exc(),
            })


if __name__ == "__main__":
    main()
