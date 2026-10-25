"""Playwright browser automation module.

Runs browser automation in headless/detached Playwright instances.
Never hijacks the active system mouse cursor or keyboard focus.
Uses sync Playwright for rock-solid stability across LangGraph execution steps.
"""

from __future__ import annotations

import base64
import os
from typing import Any, Optional

from playwright.sync_api import sync_playwright, Browser, BrowserContext, Page, Playwright


class BrowserAutomation:
    """Manages detached Playwright browser sessions for RPA automation."""
    
    def __init__(self):
        self._playwright: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        self._downloads_dir = os.path.join(
            os.environ.get("RPA_DATA_DIR", os.path.expanduser("~/.rpa-agent-platform")),
            "downloads",
        )
        os.makedirs(self._downloads_dir, exist_ok=True)
    
    def launch(self, headless: bool = True) -> None:
        """Launch detached browser instance."""
        if self._page and not self._page.is_closed():
            return

        self._playwright = sync_playwright().start()
        self._browser = self._playwright.chromium.launch(
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
            ],
        )
        self._context = self._browser.new_context(
            viewport={"width": 1440, "height": 900},
            accept_downloads=True,
        )
        self._page = self._context.new_page()

    def navigate(self, url: str) -> dict:
        """Navigate to target URL."""
        self.launch()
        response = self._page.goto(url, wait_until="domcontentloaded", timeout=15000)
        return {
            "url": self._page.url,
            "title": self._page.title(),
            "status": response.status if response else 200,
            "content": f"Navigated to {self._page.url} ({self._page.title()})",
        }

    def click(self, selector: str, timeout: int = 10000) -> dict:
        self.launch()
        self._page.click(selector, timeout=timeout)
        return {"action": "click", "selector": selector, "success": True}

    def fill(self, selector: str, value: str, timeout: int = 10000) -> dict:
        self.launch()
        self._page.fill(selector, value, timeout=timeout)
        return {"action": "fill", "selector": selector, "value": value, "success": True}

    def get_text(self, selector: str, timeout: int = 10000) -> dict:
        self.launch()
        el = self._page.wait_for_selector(selector, timeout=timeout)
        text = el.text_content() if el else ""
        return {"content": text}

    def get_page_content(self) -> dict:
        self.launch()
        # Extract title and primary text content
        title = self._page.title()
        url = self._page.url
        text = self._page.evaluate("() => document.body.innerText.substring(0, 4000)")
        return {
            "title": title,
            "url": url,
            "content": f"Page Title: {title}\nURL: {url}\n\nContent:\n{text}",
        }

    def screenshot(self, full_page: bool = False) -> dict:
        self.launch()
        raw_bytes = self._page.screenshot(full_page=full_page)
        b64 = base64.b64encode(raw_bytes).decode("utf-8")
        return {"screenshot_base64": b64, "content": "Screenshot captured"}

    def evaluate(self, expression: str) -> dict:
        self.launch()
        res = self._page.evaluate(expression)
        return {"result": res, "content": str(res)}

    def close(self) -> None:
        try:
            if self._page:
                self._page.close()
            if self._context:
                self._context.close()
            if self._browser:
                self._browser.close()
            if self._playwright:
                self._playwright.stop()
        except Exception:
            pass
        self._page = None
        self._context = None
        self._browser = None
        self._playwright = None


_browser_session: Optional[BrowserAutomation] = None


def get_browser_session() -> BrowserAutomation:
    global _browser_session
    if _browser_session is None:
        _browser_session = BrowserAutomation()
    return _browser_session


def execute_browser_step(step: dict, state: dict) -> dict:
    """Execute a browser automation step synchronously."""
    params = step.get("parameters", {})
    action = params.get("action", "navigate")
    browser = get_browser_session()
    
    if action == "navigate":
        url = params.get("url", "https://example.com")
        return browser.navigate(url)
    elif action == "click":
        return browser.click(params["selector"])
    elif action == "fill":
        return browser.fill(params["selector"], params["value"])
    elif action == "get_text":
        return browser.get_text(params["selector"])
    elif action == "get_content":
        return browser.get_page_content()
    elif action == "screenshot":
        return browser.screenshot(full_page=params.get("full_page", False))
    elif action == "evaluate":
        return browser.evaluate(params["expression"])
    else:
        return browser.navigate(params.get("url", "https://example.com"))
