"""LangGraph RPA Agent Execution Engine - Sidecar Entrypoint.

This module serves as the main entry point for the Python sidecar process.
It communicates with the Tauri frontend via JSON messages over stdin/stdout.
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
    prepare_draft_node,
    human_review_node,
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
    """Construct the LangGraph agent execution graph."""
    graph = StateGraph(AgentState)
    
    # Add nodes
    graph.add_node("intake_classifier", intake_classifier_node)
    graph.add_node("reject", reject_node)
    graph.add_node("plan", planning_node)
    graph.add_node("execute", execution_node)
    graph.add_node("prepare_draft", prepare_draft_node)
    graph.add_node("human_review", human_review_node)
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
        {"execute": "execute", "prepare_draft": "prepare_draft"},
    )
    
    graph.add_edge("prepare_draft", "human_review")
    
    graph.add_conditional_edges(
        "human_review",
        should_continue_after_review,
        {"finalize": "finalize", "revise": "revise"},
    )
    
    # Revisions cycle back to human_review
    graph.add_edge("revise", "human_review")
    graph.add_edge("finalize", END)
    
    return graph


def main():
    """Main sidecar loop: read commands from stdin, execute graph, write results to stdout."""
    _emit("status", {"step": "init", "message": "Autonomous RPA Python Engine initialized and active"})
    
    checkpointer = SQLiteCheckpointer()
    graph = build_graph()
    compiled_graph = graph.compile(checkpointer=checkpointer)
    
    active_threads: dict[str, dict] = {}
    
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
            for event in compiled_graph.stream(initial_state, config=config):
                if isinstance(event, dict) and "__interrupt__" in event:
                    _emit("status", {
                        "step": "paused",
                        "message": "Awaiting human review in HITL modal",
                        "thread_id": tid,
                    })
        except Exception as graph_error:
            error_name = type(graph_error).__name__.lower()
            if "interrupt" in error_name or "graphinterrupt" in error_name:
                _emit("status", {
                    "step": "paused",
                    "message": "Awaiting human review in HITL modal",
                    "thread_id": tid,
                })
            else:
                err_msg = str(graph_error) or type(graph_error).__name__
                _emit("error", {
                    "message": f"Execution halted: {err_msg}",
                    "traceback": traceback.format_exc(),
                })

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
                thread_id = data.get("thread_id")
                prompt = data.get("prompt", "")
                api_key = data.get("api_key", "")
                
                if not prompt:
                    _emit("error", {"message": "Missing 'prompt' in start message"})
                    continue
                
                run_start(prompt, api_key, thread_id)
            
            elif msg_type == "resume":
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
                
                resume_input = Command(resume={"decision": decision, "feedback": feedback})
                
                try:
                    for event in compiled_graph.stream(resume_input, config=config):
                        if isinstance(event, dict) and "__interrupt__" in event:
                            _emit("status", {
                                "step": "paused",
                                "message": "Awaiting human review in HITL modal",
                                "thread_id": thread_id,
                            })
                except Exception as graph_error:
                    error_name = type(graph_error).__name__.lower()
                    if "interrupt" in error_name or "graphinterrupt" in error_name:
                        _emit("status", {
                            "step": "paused",
                            "message": "Awaiting human review in HITL modal",
                            "thread_id": thread_id,
                        })
                    else:
                        err_msg = str(graph_error) or type(graph_error).__name__
                        _emit("error", {
                            "message": f"Resume error: {err_msg}",
                            "traceback": traceback.format_exc(),
                        })
            
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
            err_msg = str(e) or type(e).__name__
            _emit("error", {
                "message": f"Sidecar error: {err_msg}",
                "traceback": traceback.format_exc(),
            })


if __name__ == "__main__":
    main()
