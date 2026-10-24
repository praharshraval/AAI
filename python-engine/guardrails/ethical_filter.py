"""Ethical pre-flight classifier for prompt safety evaluation.

Evaluates incoming user prompts before they enter the agent graph.
Immediately rejects prompts requesting malicious, destructive, or
unauthorized actions.
"""

from __future__ import annotations

import json
import re
from typing import Any

from langchain_google_genai import ChatGoogleGenerativeAI


# Hard-coded rejection patterns (checked before LLM call to save tokens)
BLOCKLIST_PATTERNS: list[re.Pattern] = [
    re.compile(r"\b(credential\s*harvest|steal\s*(password|credential|cookie|token)s?)\b", re.I),
    re.compile(r"\b(ddos|denial.of.service|flood\s*attack)\b", re.I),
    re.compile(r"\b(ransomware|encrypt\s*files?\s*for\s*ransom|crypto\s*lock)\b", re.I),
    re.compile(r"\b(keylog(ger)?|screen\s*capture\s*without\s*consent)\b", re.I),
    re.compile(r"\b(bypass\s*(auth|captcha|security|firewall))\b", re.I),
    re.compile(r"\b(inject\s*(sql|xss|malware|payload))\b", re.I),
    re.compile(r"\b(phishing|spoof\s*email|fake\s*login)\b", re.I),
    re.compile(r"\b(brute\s*force|password\s*crack)\b", re.I),
    re.compile(r"\b(scrape\s*without\s*(permission|authorization|consent))\b", re.I),
    re.compile(r"\b(delete\s*all|wipe\s*(system|drive|disk)|format\s*(c:|drive))\b", re.I),
    re.compile(r"\b(disable\s*(antivirus|firewall|security))\b", re.I),
    re.compile(r"\b(privilege\s*escalat|root\s*exploit|sudo\s*bypass)\b", re.I),
]

CLASSIFICATION_PROMPT = """You are a safety classifier for an RPA (Robotic Process Automation) platform.
Evaluate whether the following user request is SAFE or UNSAFE to execute as a desktop automation task.

A request is UNSAFE if it:
1. Attempts unauthorized access to systems, accounts, or data
2. Requests credential harvesting, phishing, or social engineering
3. Involves malware deployment, DDoS, or destructive attacks
4. Scrapes data in violation of terms of service or without authorization
5. Attempts to bypass security controls or authentication
6. Could cause irreversible harm to systems or data without proper authorization
7. Involves surveillance or monitoring without consent
8. Requests illegal activities

A request is SAFE if it:
1. Automates legitimate personal or business workflows
2. Works with the user's own accounts and authorized systems
3. Performs data entry, report generation, or file management
4. Automates web browsing tasks on authorized sites
5. Generates documents, spreadsheets, or analysis

USER REQUEST:
{prompt}

Respond with ONLY a JSON object (no markdown):
{{"classification": "safe" or "unsafe", "reason": "<brief explanation>", "risk_level": "low" or "medium" or "high"}}
"""


def _check_blocklist(prompt: str) -> tuple[bool, str]:
    """Fast pattern-based check before LLM evaluation."""
    for pattern in BLOCKLIST_PATTERNS:
        match = pattern.search(prompt)
        if match:
            return True, f"Blocked by safety filter: matched prohibited pattern '{match.group()}'"
    return False, ""


def evaluate_prompt(prompt: str, api_key: str) -> dict[str, Any]:
    """Evaluate a user prompt for safety.
    
    Two-stage evaluation:
    1. Fast regex blocklist check (no API call needed)
    2. LLM-based nuanced classification via Gemini
    
    Args:
        prompt: The user's automation request
        api_key: Google Gemini API key
        
    Returns:
        dict with 'classification' ('safe'/'unsafe'), 'reason', and 'risk_level'
    """
    # Stage 1: Fast blocklist check
    blocked, reason = _check_blocklist(prompt)
    if blocked:
        return {
            "classification": "unsafe",
            "reason": reason,
            "risk_level": "high",
        }
    
    # Stage 2: LLM classification
    try:
        llm = ChatGoogleGenerativeAI(
            model="gemini-2.0-flash",
            google_api_key=api_key,
            temperature=0.0,
        )
        
        response = llm.invoke(CLASSIFICATION_PROMPT.format(prompt=prompt))
        
        result_text = response.content.strip()
        # Strip markdown fencing if present
        if result_text.startswith("```"):
            result_text = result_text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        
        result = json.loads(result_text)
        
        # Validate response structure
        if result.get("classification") not in ("safe", "unsafe"):
            result["classification"] = "unsafe"  # Default to safe-side
            result["reason"] = "Classification ambiguous - defaulting to unsafe"
        
        return result
        
    except Exception as e:
        # On LLM failure, default to unsafe for safety
        return {
            "classification": "unsafe",
            "reason": f"Safety evaluation failed ({e}). Defaulting to reject for safety.",
            "risk_level": "high",
        }
