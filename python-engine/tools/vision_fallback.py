"""Gemini multimodal vision fallback for UI element location.

When DOM selectors or coordinates fail during browser automation
(e.g., dynamic UI changes, DPI scaling issues), this module captures
a viewport screenshot and queries Gemini's vision endpoint to
visually locate element coordinates.
"""

from __future__ import annotations

import base64
import json
from typing import Any, Optional

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage


VISION_LOCATE_PROMPT = """You are a UI automation assistant with visual analysis capabilities.

Analyze the provided screenshot and locate the UI element described below.
Return the element's position as pixel coordinates within the viewport.

ELEMENT TO LOCATE: {element_description}

Respond with ONLY a JSON object (no markdown fencing):
{{
    "found": true/false,
    "x": <center x pixel coordinate>,
    "y": <center y pixel coordinate>,
    "width": <estimated element width in pixels>,
    "height": <estimated element height in pixels>,
    "confidence": <0.0 to 1.0>,
    "description": "<what the element appears to be>"
}}

If you cannot find the element, set "found" to false and explain in "description".
"""


def locate_element_visually(
    screenshot_base64: str,
    element_description: str,
    api_key: str,
) -> dict[str, Any]:
    """Use Gemini vision to locate a UI element in a screenshot.
    
    Args:
        screenshot_base64: Base64-encoded PNG screenshot of the viewport
        element_description: Natural language description of the element to find
            (e.g., "the blue Submit button", "the search input field")
        api_key: Google Gemini API key
        
    Returns:
        dict with 'found', 'x', 'y', 'width', 'height', 'confidence', 'description'
    """
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        google_api_key=api_key,
        temperature=0.0,
    )
    
    message = HumanMessage(
        content=[
            {"type": "text", "text": VISION_LOCATE_PROMPT.format(element_description=element_description)},
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{screenshot_base64}"},
            },
        ]
    )
    
    response = llm.invoke([message])
    
    result_text = response.content.strip()
    if result_text.startswith("```"):
        result_text = result_text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    
    try:
        result = json.loads(result_text)
    except json.JSONDecodeError:
        result = {
            "found": False,
            "x": 0,
            "y": 0,
            "width": 0,
            "height": 0,
            "confidence": 0.0,
            "description": f"Failed to parse vision response: {result_text[:200]}",
        }
    
    return result


def execute_vision_step(step: dict, state: dict) -> dict:
    """Execute a vision-based element location step.
    
    Used as a fallback when standard DOM selectors fail.
    Can also be used proactively for complex dynamic UIs.
    """
    params = step.get("parameters", {})
    api_key = state.get("api_key", "")
    
    screenshot_b64 = params.get("screenshot_base64") or state.get("screenshot_base64")
    
    if not screenshot_b64:
        # Need to capture a screenshot first
        from tools.browser import execute_browser_step
        result = execute_browser_step(
            {"parameters": {"action": "screenshot", "full_page": False}},
            state,
        )
        screenshot_b64 = result.get("screenshot_base64", "")
    
    if not screenshot_b64:
        return {"error": "No screenshot available for vision analysis"}
    
    element_desc = params.get("element_description", step.get("action", ""))
    
    location = locate_element_visually(screenshot_b64, element_desc, api_key)
    
    return {
        "vision_result": location,
        "element_description": element_desc,
        "action": "locate",
    }
