/**
 * CreateAgentModal.jsx - Interactive Requirements Gathering & Agent Compiler
 *
 * Implements a real-time conversational requirements analysis flow:
 * 1. User enters natural-language directive.
 * 2. Connected directly to Gemini 2.0 Flash via native IPC bridge.
 * 3. Gemini asks targeted clarifying questions (targets, credentials, parameters, deliverables).
 * 4. User provides missing details multi-turn.
 * 5. Once satisfied, Gemini compiles the complete execution manifest.
 * 6. User builds and saves agent to SQLite (with optional 1-click launch).
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Sparkles,
  Loader2,
  Send,
  Bot,
  User,
  Shield,
  Globe,
  HardDrive,
  CheckCircle2,
  Play,
  Layers,
  Key,
  FileCode,
  ArrowRight,
} from 'lucide-react';
import useTauri from '../hooks/useTauri';
import useStore from '../hooks/useStore';

export default function CreateAgentModal({ isOpen, onClose, onAgentCreated }) {
  const { queryGemini, saveAgent, getApiKey, getAgents } = useTauri();
  const setAgents = useStore((s) => s.setAgents);

  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        "👋 **Welcome to the Agent Architect.**\n\nTell me what automation you want to build. For example:\n- *'Scrape tech news headlines from Hacker News and save to Desktop/news_report.md'*\n- *'Log into my reporting portal and extract the weekly sales data into an Excel/CSV file'*\n- *'Write a Python script that monitors disk storage and alerts me'*",
    },
  ]);

  const [input, setInput] = useState('');
  const [isQuerying, setIsQuerying] = useState(false);
  const [compiledSpec, setCompiledSpec] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, compiledSpec]);

  if (!isOpen) return null;

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isQuerying) return;

    setError(null);
    const userMsg = { role: 'user', content: trimmed };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setIsQuerying(true);

    try {
      const { data: apiKey } = await getApiKey();

      // Format messages for Gemini API
      const geminiContents = updatedMessages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      const systemInstruction = `You are an Autonomous Enterprise RPA Agent Architect.
Your goal is to converse with the user and gather all necessary requirements to construct a robust, production-ready autonomous agent workflow.

ANALYZE THE USER DIRECTIVE:
1. Identify the core automation objective.
2. Determine if critical details are missing:
   - Target URL / Endpoint (if web or browser automation)
   - Authentication / Credentials (ask if login is needed, and if credentials will be provided now or during live execution)
   - Specific data fields, selectors, or parsing criteria
   - Output deliverable format and destination (e.g. filename on Desktop or in workspace sandbox)
   - Guardrails or error-handling requirements

CONVERSATION RULES:
- If ANY critical information is missing, ask 1 to 3 direct, numbered clarifying questions in a concise, professional tone. Do NOT output the final JSON manifest yet.
- When the user has answered the questions and you have gathered sufficient information (OR if the user provided all required details in their prompt upfront):
  1. Provide a concise summary of the gathered requirements.
  2. At the very end of your response, output a single fenced JSON block with this EXACT structure:
\`\`\`json
{
  "ready": true,
  "name": "<concise agent name (3 to 6 words)>",
  "description": "<1-2 sentence description of what the agent accomplishes>",
  "category": "Browser RPA" | "Data Pipeline" | "System Automation" | "Research & Intelligence",
  "tools": ["browser", "filesystem", "gemini", "user_input"],
  "manifest": {
    "title": "<agent name>",
    "description": "<description>",
    "steps": [
      {
        "action": "<detailed step action>",
        "tool": "browser" | "filesystem" | "gemini" | "user_input",
        "parameters": {}
      }
    ]
  }
}
\`\`\`
- If credentials or passwords are needed at runtime, include a step with "tool": "user_input" and "parameters": {"field_name": "credentials", "prompt": "Please enter credentials to proceed"}.
- If files need to be created, include a "filesystem" step with "action": "write" and "path": "<filename>".
- Ensure the steps are atomic, real, and actionable.`;

      const { data: responseText, error: queryError } = await queryGemini(
        geminiContents,
        systemInstruction,
        apiKey
      );

      if (queryError) {
        throw new Error(queryError);
      }

      // Check if response contains the ready JSON manifest
      let parsedManifest = null;
      let cleanText = responseText;

      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.ready && parsed.manifest) {
            parsedManifest = parsed;
            // Ensure step_ids
            parsedManifest.manifest.steps = (parsedManifest.manifest.steps || []).map((s) => ({
              ...s,
              step_id: s.step_id || crypto.randomUUID(),
              status: 'pending',
              retry_count: 0,
              max_retries: 3,
            }));
            cleanText = responseText.replace(/```json[\s\S]*?```/, '').trim();
          }
        } catch (jsonErr) {
          console.warn('[CreateAgentModal] Failed to parse manifest JSON:', jsonErr);
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: cleanText || responseText,
        },
      ]);

      if (parsedManifest) {
        setCompiledSpec(parsedManifest);
      }
    } catch (err) {
      console.error('[CreateAgentModal] Query error:', err);
      setError(`Gemini connection error: ${err.message}`);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ Could not reach Gemini: ${err.message}. Please verify your API key in Settings.`,
        },
      ]);
    } finally {
      setIsQuerying(false);
    }
  };

  const handleSaveAndBuild = async (autoRun = false) => {
    if (!compiledSpec) return;
    setIsSaving(true);
    setError(null);

    try {
      const now = new Date().toISOString();
      const firstUserMsg = messages.find((m) => m.role === 'user');
      const directiveText = firstUserMsg ? firstUserMsg.content : compiledSpec.name;

      const newAgent = {
        id: crypto.randomUUID(),
        name: compiledSpec.name || 'Autonomous RPA Agent',
        description: compiledSpec.description || directiveText,
        prompt: directiveText,
        manifest_json: JSON.stringify(compiledSpec.manifest || {}),
        status: 'idle',
        created_at: now,
        updated_at: now,
      };

      const res = await saveAgent(newAgent);
      if (res.error) {
        throw new Error(res.error);
      }

      // Refresh agents in store
      const { data: allAgents } = await getAgents();
      if (allAgents) setAgents(allAgents);

      setIsSaving(false);
      onClose();

      if (onAgentCreated) {
        onAgentCreated(newAgent, { autoRun });
      }
    } catch (err) {
      console.error('[CreateAgentModal] Save error:', err);
      setError(`Failed to save agent: ${err.message}`);
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm select-none">
      <div className="flex h-[86vh] w-full max-w-3xl flex-col rounded-2xl border border-zinc-800 bg-[#0d0d11] shadow-2xl overflow-hidden">
        {/* ── Modal Header ────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/80 bg-[#111116] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700/60 text-zinc-100 shadow-inner">
              <Bot size={17} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-zinc-100">
                  Autonomous Agent Architect
                </h2>
                <span className="flex items-center gap-1 rounded bg-zinc-800/90 px-2 py-0.5 font-mono text-[10px] text-zinc-300 border border-zinc-700/50">
                  <Sparkles size={10} className="text-amber-400" />
                  Gemini Flash
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Interactive requirements gathering & LangGraph execution pipeline compiler
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Conversation Stream ─────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 font-sans text-xs">
          {messages.map((m, idx) => {
            const isUser = m.role === 'user';
            return (
              <div
                key={idx}
                className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200">
                    <Bot size={14} />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-xl px-4 py-3 leading-relaxed whitespace-pre-wrap ${
                    isUser
                      ? 'bg-zinc-100 text-zinc-950 font-medium'
                      : 'bg-zinc-900 border border-zinc-800/90 text-zinc-200 shadow-sm'
                  }`}
                >
                  {m.content}
                </div>

                {isUser && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200">
                    <User size={14} />
                  </div>
                )}
              </div>
            );
          })}

          {isQuerying && (
            <div className="flex items-center gap-3 text-zinc-400">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300">
                <Bot size={14} />
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-2.5 text-xs text-zinc-400">
                <Loader2 size={13} className="animate-spin text-zinc-400" />
                <span>Gemini Flash is analyzing requirements...</span>
              </div>
            </div>
          )}

          {/* ── Compiled Specification Preview Card ─────────── */}
          {compiledSpec && (
            <div className="mt-4 rounded-xl border border-emerald-800/60 bg-emerald-950/20 p-4 text-xs text-zinc-200 space-y-3 shadow-lg">
              <div className="flex items-center justify-between border-b border-emerald-800/40 pb-2.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                  <span className="font-semibold text-emerald-300">
                    Agent Blueprint Ready: {compiledSpec.name}
                  </span>
                </div>
                <span className="rounded bg-emerald-900/50 px-2 py-0.5 font-mono text-[10px] text-emerald-300 border border-emerald-800/60">
                  {compiledSpec.category || 'Autonomous RPA'}
                </span>
              </div>

              <p className="text-zinc-300 text-[11px] leading-relaxed">
                {compiledSpec.description}
              </p>

              {/* Execution Steps Pipeline Preview */}
              {compiledSpec.manifest?.steps?.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400">
                    Compiled Coordinated Pipeline ({compiledSpec.manifest.steps.length} Steps):
                  </span>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {compiledSpec.manifest.steps.map((st, i) => (
                      <div
                        key={st.step_id || i}
                        className="flex items-center gap-2 rounded-lg bg-zinc-900/80 border border-zinc-800 px-3 py-1.5 text-[11px]"
                      >
                        <span className="font-mono text-[10px] text-zinc-500 w-4">
                          {i + 1}.
                        </span>
                        {st.tool === 'browser' && (
                          <Globe size={12} className="text-sky-400 shrink-0" />
                        )}
                        {st.tool === 'filesystem' && (
                          <HardDrive size={12} className="text-amber-400 shrink-0" />
                        )}
                        {st.tool === 'user_input' && (
                          <Key size={12} className="text-rose-400 shrink-0" />
                        )}
                        {st.tool === 'gemini' && (
                          <Sparkles size={12} className="text-purple-400 shrink-0" />
                        )}
                        <span className="font-medium text-zinc-200 truncate flex-1">
                          {st.action}
                        </span>
                        <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                          {st.tool}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-emerald-800/40">
                <button
                  type="button"
                  onClick={() => handleSaveAndBuild(false)}
                  disabled={isSaving}
                  className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-3.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
                >
                  Save to Library
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveAndBuild(true)}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 transition-colors shadow-sm"
                >
                  <Play size={12} className="fill-current" />
                  <span>Build & Launch Now</span>
                </button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {error && (
          <div className="mx-5 mb-2 rounded-lg border border-rose-900/60 bg-rose-950/30 p-2.5 text-xs text-rose-300">
            {error}
          </div>
        )}

        {/* ── Input Box ───────────────────────────────────────── */}
        <form
          onSubmit={handleSendMessage}
          className="shrink-0 border-t border-zinc-800/80 bg-[#111116] p-4"
        >
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                compiledSpec
                  ? 'Refine requirements, request changes, or click Launch above...'
                  : messages.length === 1
                  ? 'Describe what you want the agent to automate...'
                  : 'Answer questions, provide URLs/credentials, or refine requirements...'
              }
              disabled={isQuerying || isSaving}
              autoFocus
              className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-600 transition-colors"
            />
            <button
              type="submit"
              disabled={!input.trim() || isQuerying || isSaving}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-100 text-zinc-900 hover:bg-white transition-colors disabled:opacity-40 shrink-0 shadow-sm"
            >
              {isQuerying ? (
                <Loader2 size={15} className="animate-spin text-zinc-800" />
              ) : (
                <Send size={15} />
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
