/**
 * ChatIntake.jsx - Enterprise RPA Orchestration Console
 *
 * Professional, high-density execution interface designed for enterprise workflows.
 * Features 1-click multi-agent templates, real-time DAG step pipeline visualizer,
 * monospace event telemetry log, and Human-in-the-Loop review integration.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Square,
  Globe,
  FileSpreadsheet,
  Terminal,
  Server,
  Layers,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  RotateCcw,
  CheckCircle2,
  Clock,
  AlertCircle,
  Copy,
  Check,
  Sparkles,
} from 'lucide-react';
import useStore from '../hooks/useStore';
import useTauri from '../hooks/useTauri';

// ─── Pre-Configured Multi-Agent Templates ──────────────────────────────

const TEMPLATES = [
  {
    id: 'web-intel',
    name: 'Web Intelligence & Headless Scraper',
    icon: Globe,
    category: 'Browser RPA',
    prompt: 'Scrape technology headlines and summarize market trends',
    desc: 'Spawns detached Playwright Chromium, navigates data sources, extracts DOM text nodes, and synthesizes structured JSON.',
  },
  {
    id: 'finance-audit',
    name: 'Financial Expense Audit & CSV Export',
    icon: FileSpreadsheet,
    category: 'Data Pipeline',
    prompt: 'Analyze quarterly sales figures and prepare financial audit spreadsheet',
    desc: 'Inspects local filesystem sandbox, normalizes records, exports processed_audit_report.csv, and calculates variance.',
  },
  {
    id: 'system-health',
    name: 'Workspace Sandbox & Directory Inspector',
    icon: Server,
    category: 'System RPA',
    prompt: 'Scan workspace directory, audit file checksums, and generate integrity report',
    desc: 'Executes sandboxed filesystem discovery, verifies read/write integrity, and logs storage telemetry.',
  },
  {
    id: 'market-brief',
    name: 'Executive Market Research Synthesis',
    icon: Layers,
    category: 'Autonomous Multi-Agent',
    prompt: 'Conduct multi-agent competitive analysis for desktop automation platforms and create executive report',
    desc: 'Decomposes strategic analysis into multi-agent research steps, generates briefing, and requests HITL approval.',
  },
];

export default function ChatIntake() {
  const chatMessages = useStore((s) => s.chatMessages);
  const sidecarStatus = useStore((s) => s.sidecarStatus);
  const activeManifest = useStore((s) => s.activeManifest);
  const stepProgress = useStore((s) => s.stepProgress);
  const addChatMessage = useStore((s) => s.addChatMessage);
  const clearChat = useStore((s) => s.clearChat);

  const { startSidecar, stopSidecar, getApiKey } = useTauri();

  const [input, setInput] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [copiedLog, setCopiedLog] = useState(false);
  const [activeTab, setActiveTab] = useState('pipeline'); // 'pipeline' | 'logs'
  const logEndRef = useRef(null);
  const textareaRef = useRef(null);

  const isRunning = sidecarStatus === 'running';
  const isPaused = sidecarStatus === 'paused';
  const isBusy = isRunning || isPaused;

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSelectTemplate = (tmpl) => {
    setSelectedTemplate(tmpl.id);
    setInput(tmpl.prompt);
    textareaRef.current?.focus();
  };

  const handleExecute = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isBusy) return;

    // 1. Add user task entry
    addChatMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    });

    setInput('');

    // 2. Resolve key and dispatch to engine
    const { data: apiKey } = await getApiKey();
    const effectiveKey = apiKey || 'local-mode';

    const { data: agent, error } = await startSidecar(trimmed, effectiveKey);
    if (error) {
      addChatMessage({
        id: crypto.randomUUID(),
        role: 'system',
        content: `Execution dispatch failed: ${error}`,
        timestamp: new Date().toISOString(),
        isError: true,
      });
    } else if (agent) {
      addChatMessage({
        id: crypto.randomUUID(),
        role: 'system',
        content: `Dispatched task [${agent.id.slice(0, 8)}] to Autonomous Engine. Evaluating ethical guardrails...`,
        timestamp: new Date().toISOString(),
      });
    }
  }, [input, isBusy, addChatMessage, getApiKey, startSidecar]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleExecute();
    }
  };

  const copySessionLogs = () => {
    const text = chatMessages
      .map((m) => `[${m.timestamp?.slice(11, 19) || 'LOG'}] ${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopiedLog(true);
    setTimeout(() => setCopiedLog(false), 2000);
  };

  return (
    <div className="flex h-full flex-col bg-[#09090b] text-zinc-200">
      {/* ── Top Bar / Engine Status ───────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/80 bg-[#0d0d10] px-6 py-2.5">
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-2 rounded-md bg-zinc-900 border border-zinc-800 px-2.5 py-1 text-zinc-300">
            <span
              className={`h-2 w-2 rounded-full ${
                isRunning
                  ? 'bg-emerald-400 animate-pulse'
                  : isPaused
                  ? 'bg-amber-400'
                  : sidecarStatus === 'error'
                  ? 'bg-rose-500'
                  : 'bg-zinc-500'
              }`}
            />
            <span className="font-mono uppercase font-semibold text-[11px]">
              Engine: {sidecarStatus}
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 text-zinc-400 text-xs">
            <ShieldCheck size={14} className="text-emerald-400" />
            <span>Local Guardrails Active</span>
          </div>

          <span className="text-zinc-600">|</span>

          <span className="font-mono text-[11px] text-zinc-500">
            Sandbox: ~/.rpa-agent-platform/workspace/
          </span>
        </div>

        <div className="flex items-center gap-2">
          {chatMessages.length > 0 && (
            <button
              onClick={clearChat}
              className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
              title="Clear terminal session"
            >
              <RotateCcw size={12} />
              Reset
            </button>
          )}

          {isRunning && (
            <button
              onClick={stopSidecar}
              className="flex items-center gap-1 rounded bg-rose-950/40 border border-rose-800/60 px-2.5 py-1 text-[11px] font-medium text-rose-300 hover:bg-rose-900/50 transition-colors"
            >
              <Square size={12} fill="currentColor" />
              Halt Engine
            </button>
          )}
        </div>
      </div>

      {/* ── Main Workspace Body ───────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Side: Task Intake & Templates */}
        <div className="flex w-full md:w-1/2 flex-col border-r border-zinc-800/80 bg-[#0b0b0e]">
          {/* Preset Templates */}
          <div className="border-b border-zinc-800/80 p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Enterprise Multi-Agent Recipes
              </span>
              <span className="text-[10px] text-zinc-500">Click to load</span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {TEMPLATES.map((tmpl) => {
                const Icon = tmpl.icon;
                const isSelected = selectedTemplate === tmpl.id;
                return (
                  <button
                    key={tmpl.id}
                    onClick={() => handleSelectTemplate(tmpl)}
                    className={`flex flex-col text-left rounded-lg border p-2.5 transition-all ${
                      isSelected
                        ? 'border-emerald-500/50 bg-emerald-950/20 text-zinc-100 shadow-sm'
                        : 'border-zinc-800/80 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded bg-zinc-800 text-zinc-300">
                        <Icon size={13} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{tmpl.name}</p>
                        <p className="text-[10px] text-zinc-500">{tmpl.category}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Prompt Editor */}
          <div className="flex flex-1 flex-col p-4">
            <label className="mb-2 block text-xs font-semibold text-zinc-300">
              Task Directive & Automation Prompt
            </label>

            <div className="relative flex flex-1 flex-col rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 shadow-inner focus-within:border-zinc-600 transition-colors">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Specify the RPA task or select an enterprise template above. Example: 'Scrape tech news headlines, structure the data, and prepare an executive summary report.'"
                className="w-full flex-1 resize-none bg-transparent font-mono text-xs text-zinc-200 placeholder-zinc-600 outline-none leading-relaxed"
              />

              <div className="mt-3 flex items-center justify-between border-t border-zinc-800/80 pt-2 text-[11px] text-zinc-500">
                <span className="font-mono">
                  Press <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">⌘+Enter</kbd> to execute
                </span>

                <button
                  onClick={handleExecute}
                  disabled={!input.trim() || isBusy}
                  className="inline-flex items-center gap-2 rounded-md bg-zinc-100 px-4 py-1.5 text-xs font-semibold text-zinc-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play size={13} fill="currentColor" />
                  Dispatch Task
                </button>
              </div>
            </div>

            {/* Quick Specs */}
            <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500">
              <span>Engine Model: Gemini 2.0 Flash / Local Orchestrator</span>
              <span>Memory Checkpoint: SQLite WAL</span>
            </div>
          </div>
        </div>

        {/* Right Side: Live Multi-Agent Pipeline & Terminal Logs */}
        <div className="flex w-full md:w-1/2 flex-col bg-[#09090b]">
          {/* Sub Navigation */}
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/80 bg-[#0d0d10] px-4 py-2">
            <div className="flex gap-2 text-xs">
              <button
                onClick={() => setActiveTab('pipeline')}
                className={`rounded px-3 py-1 font-medium transition-colors ${
                  activeTab === 'pipeline'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Multi-Agent Pipeline
                {activeManifest?.steps && (
                  <span className="ml-1.5 rounded-full bg-zinc-700 px-1.5 py-0.2 text-[10px]">
                    {activeManifest.steps.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('logs')}
                className={`rounded px-3 py-1 font-medium transition-colors ${
                  activeTab === 'logs'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Execution Telemetry
              </button>
            </div>

            {activeTab === 'logs' && (
              <button
                onClick={copySessionLogs}
                className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200"
              >
                {copiedLog ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                {copiedLog ? 'Copied' : 'Copy Logs'}
              </button>
            )}
          </div>

          {/* Tab Content: Multi-Agent Pipeline View */}
          {activeTab === 'pipeline' && (
            <div className="flex-1 overflow-y-auto p-4">
              {!activeManifest ? (
                <div className="flex h-full flex-col items-center justify-center text-center text-zinc-500">
                  <Layers size={36} className="mb-3 text-zinc-700" />
                  <p className="text-sm font-medium text-zinc-400">No active manifest loaded</p>
                  <p className="mt-1 text-xs text-zinc-600 max-w-sm">
                    Select a template or type a prompt on the left to synthesize a multi-agent execution pipeline.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Manifest Header */}
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3.5">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-zinc-100">
                          {activeManifest.title}
                        </h3>
                        <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                          {activeManifest.description}
                        </p>
                      </div>
                      <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                        {activeManifest.steps?.length || 0} STEPS
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-zinc-500">
                      <span className="rounded bg-zinc-950 px-2 py-1 font-mono">
                        Task ID: {activeManifest.task_id?.slice(0, 12)}...
                      </span>
                      {activeManifest.requires_browser && (
                        <span className="rounded bg-sky-950/40 text-sky-300 border border-sky-800/40 px-2 py-1 font-mono">
                          Playwright Browser
                        </span>
                      )}
                      {activeManifest.requires_filesystem && (
                        <span className="rounded bg-emerald-950/40 text-emerald-300 border border-emerald-800/40 px-2 py-1 font-mono">
                          Sandboxed Filesystem
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Steps Tree */}
                  <div className="space-y-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      Execution Step Decomposition
                    </span>

                    {activeManifest.steps?.map((step, idx) => {
                      const prog = stepProgress[step.step_id] || {};
                      const isStepRunning = prog.status === 'running';
                      const isStepDone = prog.status === 'completed';
                      const isStepTripped = prog.status === 'tripped';

                      return (
                        <div
                          key={step.step_id || idx}
                          className={`rounded-lg border p-3 transition-colors ${
                            isStepRunning
                              ? 'border-amber-500/60 bg-amber-950/10'
                              : isStepDone
                              ? 'border-zinc-800 bg-zinc-900/40'
                              : isStepTripped
                              ? 'border-rose-500/60 bg-rose-950/10'
                              : 'border-zinc-800/60 bg-zinc-950/40 opacity-75'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-zinc-800 font-mono text-[10px] text-zinc-300">
                                {idx + 1}
                              </span>
                              <p className="truncate text-xs font-medium text-zinc-200">
                                {step.action}
                              </p>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className="rounded bg-zinc-800/80 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                                tool: {step.tool}
                              </span>

                              {isStepRunning && (
                                <span className="flex items-center gap-1 rounded bg-amber-900/30 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                                  <Clock size={10} className="animate-spin" />
                                  Running
                                </span>
                              )}

                              {isStepDone && (
                                <span className="flex items-center gap-1 rounded bg-emerald-900/30 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                                  <CheckCircle2 size={10} />
                                  Done
                                </span>
                              )}

                              {isStepTripped && (
                                <span className="flex items-center gap-1 rounded bg-rose-900/30 px-2 py-0.5 text-[10px] font-medium text-rose-300">
                                  <AlertCircle size={10} />
                                  Tripped
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Result Detail if available */}
                          {prog.result && (
                            <div className="mt-2.5 border-t border-zinc-800/60 pt-2 font-mono text-[11px] text-zinc-400">
                              {prog.result.content && (
                                <p className="line-clamp-2 text-zinc-300">
                                  {prog.result.content}
                                </p>
                              )}
                              {prog.result.path && (
                                <p className="text-emerald-400">
                                  Artifact: {prog.result.path} ({prog.result.size || 0} bytes)
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab Content: Monospace Terminal Event Log */}
          {activeTab === 'logs' && (
            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed bg-[#09090b]">
              {chatMessages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-zinc-600">
                  <Terminal size={24} className="mr-2" />
                  <span>Awaiting execution events...</span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {chatMessages.map((msg) => {
                    const time = msg.timestamp ? msg.timestamp.slice(11, 19) : '--:--:--';
                    const isUser = msg.role === 'user';
                    const isSystem = msg.role === 'system';

                    return (
                      <div
                        key={msg.id}
                        className={`flex items-start gap-2 rounded px-2 py-1 ${
                          msg.isError
                            ? 'bg-rose-950/30 text-rose-300'
                            : msg.isGuardrailReject
                            ? 'bg-amber-950/30 text-amber-300'
                            : isUser
                            ? 'bg-zinc-900 text-zinc-100'
                            : 'text-zinc-400 hover:bg-zinc-900/30'
                        }`}
                      >
                        <span className="shrink-0 text-zinc-600 text-[10px]">{time}</span>
                        <span
                          className={`shrink-0 font-semibold text-[10px] uppercase ${
                            isUser
                              ? 'text-sky-400'
                              : isSystem
                              ? 'text-zinc-500'
                              : 'text-emerald-400'
                          }`}
                        >
                          [{msg.role}]
                        </span>
                        <span className="flex-1 whitespace-pre-wrap break-words">{msg.content}</span>
                      </div>
                    );
                  })}
                  <div ref={logEndRef} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
