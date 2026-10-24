"""Playwright CDP browser automation module.

Runs browser automation in headless/detached Playwright instances.
Never hijacks the active system mouse cursor or keyboard focus.
Supports CDP (Chrome DevTools Protocol) for advanced automation.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
from typing import Any, Optional

from playwright.async_api import async_playwright, Browser, BrowserContext, Page


class BrowserAutomation:
    """Manages detached Playwright browser sessions for RPA automation.
    
    Key design principles:
    - Headless by default (no visible browser window stealing focus)
    - CDP connection support for attaching to existing browser instances
    - Viewport screenshots for vision fallback integration
    - Sandboxed downloads directory
    """
    
    def __init__(self):
        self._playwright = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        self._downloads_dir = os.path.join(
            os.environ.get("RPA_DATA_DIR", os.path.expanduser("~/.rpa-agent-platform")),
            "downloads"
        )
        os.makedirs(self._downloads_dir, exist_ok=True)
    
    async def launch(self, headless: bool = True, cdp_url: Optional[str] = None) -> None:
        """Launch or connect to a browser instance.
        
        Args:
            headless: Run in headless mode (default True)
            cdp_url: Optional CDP WebSocket URL to connect to an existing browser
        """
        self._playwright = await async_playwright().start()
        
        if cdp_url:
            self._browser = await self._playwright.chromium.connect_over_cdp(cdp_url)
            self._context = self._browser.contexts[0] if self._browser.contexts else await self._browser.new_context()
        else:
            self._browser = await self._playwright.chromium.launch(
                headless=headless,
                args=[
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-gpu",
                    "--disable-extensions",
                    "--disable-default-apps",
                    "--disable-translate",
                    "--disable-sync",
                    "--disable-background-networking",
                ]
            )
            self._context = await self._browser.new_context(
                viewport={"width": 1920, "height": 1080},
                accept_downloads=True,
            )
        
        self._page = await self._context.new_page()
    
    async def navigate(self, url: str, wait_until: str = "domcontentloaded") -> dict:
        """Navigate to a URL."""
        if not self._page:
            raise RuntimeError("Browser not launched. Call launch() first.")
        
        response = await self._page.goto(url, wait_until=wait_until, timeout=30000)
        
        return {
            "url": self._page.url,
            "title": await self._page.title(),
            "status": response.status if response else None,
        }
    
    async def click(self, selector: str, timeout: int = 10000) -> dict:
        """Click an element by selector."""
        if not self._page:
            raise RuntimeError("Browser not launched.")
        
        await self._page.click(selector, timeout=timeout)
        return {"action": "click", "selector": selector, "success": True}
    
    async def fill(self, selector: str, value: str, timeout: int = 10000) -> dict:
        """Fill a form field."""
        if not self._page:
            raise RuntimeError("Browser not launched.")
        
        await self._page.fill(selector, value, timeout=timeout)
        return {"action": "fill", "selector": selector, "success": True}
    
    async def get_text(self, selector: str, timeout: int = 10000) -> str:
        """Get text content of an element."""
        if not self._page:
            raise RuntimeError("Browser not launched.")
        
        element = await self._page.wait_for_selector(selector, timeout=timeout)
        return await element.text_content() if element else ""
    
    async def get_page_content(self) -> str:
        """Get the full page text content."""
        if not self._page:
            raise RuntimeError("Browser not launched.")
        
        return await self._page.content()
    
    async def screenshot(self, full_page: bool = False) -> str:
        """Capture a viewport screenshot, returned as base64 PNG.
        
        Used for vision fallback when DOM selectors fail.
        """
        if not self._page:
            raise RuntimeError("Browser not launched.")
        
        screenshot_bytes = await self._page.screenshot(full_page=full_page)
        return base64.b64encode(screenshot_bytes).decode("utf-8")
    
    async def evaluate(self, expression: str) -> Any:
        """Execute JavaScript in the page context."""
        if not self._page:
            raise RuntimeError("Browser not launched.")
        
        return await self._page.evaluate(expression)
    
    async def wait_for_selector(self, selector: str, timeout: int = 30000, state: str = "visible") -> bool:
        """Wait for an element to appear."""
        if not self._page:
            raise RuntimeError("Browser not launched.")
        
        try:
            await self._page.wait_for_selector(selector, timeout=timeout, state=state)
            return True
        except Exception:
            return False
    
    async def close(self) -> None:
        """Close browser and cleanup resources."""
        if self._page:
            await self._page.close()
        if self._context:
            await self._context.close()
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
        
        self._page = None
        self._context = None
        self._browser = None
        self._playwright = None


# -- Singleton browser pool --
_browser_pool: dict[str, BrowserAutomation] = {}


async def _get_or_create_browser(session_id: str = "default") -> BrowserAutomation:
    """Get or create a browser instance from the pool."""
    if session_id not in _browser_pool:
        browser = BrowserAutomation()
        await browser.launch(headless=True)
        _browser_pool[session_id] = browser
    return _browser_pool[session_id]


def execute_browser_step(step: dict, state: dict) -> dict:
    """Synchronous wrapper for executing a browser automation step.
    
    Translates step parameters into Playwright actions.
    Falls back to vision-based element location on selector failure.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(_execute_browser_step_async(step, state))
    finally:
        loop.close()


async def _execute_browser_step_async(step: dict, state: dict) -> dict:
    """Execute a browser step asynchronously."""
    params = step.get("parameters", {})
    action = params.get("action", "navigate")
    session_id = state.get("browser_session_id", "default")
    
    browser = await _get_or_create_browser(session_id)
    
    try:
        if action == "navigate":
            return await browser.navigate(params["url"])
        elif action == "click":
            return await browser.click(params["selector"])
        elif action == "fill":
            return await browser.fill(params["selector"], params["value"])
        elif action == "get_text":
            text = await browser.get_text(params["selector"])
            return {"content": text}
        elif action == "screenshot":
            b64 = await browser.screenshot(full_page=params.get("full_page", False))
            return {"screenshot_base64": b64}
        elif action == "get_content":
            content = await browser.get_page_content()
            return {"content": content}
        elif action == "evaluate":
            result = await browser.evaluate(params["expression"])
            return {"result": result}
        else:
            raise ValueError(f"Unknown browser action: {action}")
    
    except Exception as e:
        # On selector failure, attempt vision fallback
        if "selector" in params and ("timeout" in str(e).lower() or "not found" in str(e).lower()):
            screenshot_b64 = await browser.screenshot()
            return {
                "error": str(e),
                "fallback": "vision",
                "screenshot_base64": screenshot_b64,
                "selector": params.get("selector"),
            }
        raise
