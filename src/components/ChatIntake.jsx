/**
 * ChatIntake.jsx - Active Execution Console & Live Telemetry Stream
 *
 * Real-time monitoring and control console for running autonomous agents.
 * Renders the active LangGraph step progress, stdout event telemetry,
 * and Human-in-the-Loop review integration. Free of mock data.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Square,
  Terminal,
  Layers,
  ShieldCheck,
  RotateCcw,
  CheckCircle2,
  Clock,
  AlertCircle,
  Copy,
  Check,
  Bot,
  Send,
  Key,
} from 'lucide-react';
import useStore from '../hooks/useStore';
import useTauri from '../hooks/useTauri';

export default function ChatIntake({ activeAgent }) {
  const chatMessages = useStore((s) => s.chatMessages);
  const sidecarStatus = useStore((s) => s.sidecarStatus);
  const activeManifest = useStore((s) => s.activeManifest);
  const stepProgress = useStore((s) => s.stepProgress);
  const pendingInputRequest = useStore((s) => s.pendingInputRequest);
  const clearPendingInputRequest = useStore((s) => s.clearPendingInputRequest);
  const addChatMessage = useStore((s) => s.addChatMessage);
  const clearChat = useStore((s) => s.clearChat);

  const { startSidecar, stopSidecar, sendSidecarInput, getApiKey } = useTauri();

  const [input, setInput] = useState('');
  const [runtimeInputValue, setRuntimeInputValue] = useState('');
  const [copiedLog, setCopiedLog] = useState(false);
  const logEndRef = useRef(null);

  const isRunning = sidecarStatus === 'running';
  const isPaused = sidecarStatus === 'paused';
  const isBusy = isRunning || isPaused;

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleExecute = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isBusy) return;

    addChatMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    });

    setInput('');

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
    }
  }, [input, isBusy, addChatMessage, getApiKey, startSidecar]);

  const handleSubmitRuntimeInput = async () => {
    if (!runtimeInputValue.trim() || !pendingInputRequest) return;
    const val = runtimeInputValue.trim();
    setRuntimeInputValue('');

    addChatMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: pendingInputRequest.is_secret
        ? '🔑 Provided secured credentials: ••••••••'
        : `💬 Provided input: ${val}`,
      timestamp: new Date().toISOString(),
    });

    await sendSidecarInput({
      action: 'provide_input',
      input: val,
      field_name: pendingInputRequest.field_name,
      thread_id: pendingInputRequest.thread_id,
    });

    clearPendingInputRequest();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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
      {/* ── Status Bar ────────────────────────────────────────── */}
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

          {activeAgent && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
              <Bot size={13} className="text-zinc-400" />
              <span>{activeAgent.name}</span>
            </div>
          )}

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
            >
              <RotateCcw size={12} />
              Reset Console
            </button>
          )}

          {isRunning && (
            <button
              onClick={stopSidecar}
              className="flex items-center gap-1 rounded bg-rose-950/40 border border-rose-800/60 px-2.5 py-1 text-[11px] font-medium text-rose-300 hover:bg-rose-900/50 transition-colors"
            >
              <Square size={11} fill="currentColor" />
              Halt Engine
            </button>
          )}
        </div>
      </div>

      {/* ── Main Two-Column View ───────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Column: Live Multi-Agent Pipeline & Step Visualizer */}
        <div className="flex w-full md:w-1/2 flex-col border-r border-zinc-800/80 bg-[#0b0b0e] overflow-y-auto p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Execution Pipeline & Step Decomposition
            </span>
            {activeManifest?.steps && (
              <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                {activeManifest.steps.length} Steps
              </span>
            )}
          </div>

          {!activeManifest ? (
            <div className="flex h-64 flex-col items-center justify-center text-center text-zinc-500 border border-dashed border-zinc-800/80 rounded-xl p-6">
              <Layers size={36} className="mb-2 text-zinc-700" />
              <p className="text-xs font-medium text-zinc-300">No active execution running</p>
              <p className="mt-1 text-[11px] text-zinc-500 max-w-xs leading-relaxed">
                Click 'Run Agent' from the Agent Registry or submit a directive below to start execution.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Manifest Card */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3.5">
                <h3 className="text-xs font-semibold text-zinc-100">{activeManifest.title}</h3>
                <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                  {activeManifest.description}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2 text-[10px] text-zinc-500 font-mono">
                  <span>Task ID: {activeManifest.task_id?.slice(0, 8)}...</span>
                  {activeManifest.requires_browser && (
                    <span className="text-sky-400">Playwright Headless</span>
                  )}
                  {activeManifest.requires_filesystem && (
                    <span className="text-emerald-400">Filesystem Sandbox</span>
                  )}
                </div>
              </div>

              {/* Steps List */}
              <div className="space-y-2">
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
                          ? 'border-amber-500/60 bg-amber-950/15'
                          : isStepDone
                          ? 'border-zinc-800 bg-zinc-900/40'
                          : isStepTripped
                          ? 'border-rose-500/60 bg-rose-950/15'
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
                            {step.tool}
                          </span>

                          {isStepRunning && (
                            <span className="flex items-center gap-1 text-[10px] font-medium text-amber-300">
                              <Clock size={11} className="animate-spin" />
                              Running
                            </span>
                          )}

                          {isStepDone && (
                            <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400">
                              <CheckCircle2 size={11} />
                              Done
                            </span>
                          )}

                          {isStepTripped && (
                            <span className="flex items-center gap-1 text-[10px] font-medium text-rose-400">
                              <AlertCircle size={11} />
                              Tripped
                            </span>
                          )}
                        </div>
                      </div>

                      {prog.result && (
                        <div className="mt-2 border-t border-zinc-800/60 pt-2 font-mono text-[11px] text-zinc-400">
                          {prog.result.content && (
                            <p className="line-clamp-2 text-zinc-300">{prog.result.content}</p>
                          )}
                          {prog.result.path && (
                            <p className="text-emerald-400 font-semibold">
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

        {/* Right Column: Monospace Terminal Telemetry Logs */}
        <div className="flex w-full md:w-1/2 flex-col bg-[#09090b]">
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/80 bg-[#0d0d10] px-4 py-2">
            <span className="text-xs font-medium text-zinc-400 font-mono">
              Process Stdout Telemetry
            </span>
            <button
              onClick={copySessionLogs}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              {copiedLog ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              {copiedLog ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
            {chatMessages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-zinc-600">
                <Terminal size={20} className="mr-2" />
                <span>Engine idle. Awaiting agent execution...</span>
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

          {/* ── Mid-Execution Interactive Prompt Banner ── */}
          {pendingInputRequest && (
            <div className="border-t border-amber-500/50 bg-amber-950/30 p-3.5 space-y-2.5 animate-in fade-in slide-in-from-bottom duration-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key size={14} className="text-amber-400 shrink-0" />
                  <span className="text-xs font-semibold text-amber-200">
                    Agent Information Required
                  </span>
                </div>
                <span className="rounded bg-amber-900/60 px-2 py-0.5 font-mono text-[10px] text-amber-300 border border-amber-700/60">
                  Execution Paused
                </span>
              </div>
              <p className="text-xs text-zinc-200 leading-relaxed font-sans">
                {pendingInputRequest.prompt || 'Please provide the required parameter to continue execution:'}
              </p>
              <div className="flex items-center gap-2">
                <input
                  type={pendingInputRequest.is_secret ? 'password' : 'text'}
                  value={runtimeInputValue}
                  onChange={(e) => setRuntimeInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmitRuntimeInput();
                    }
                  }}
                  placeholder={
                    pendingInputRequest.is_secret
                      ? 'Enter secure credential / password / token...'
                      : 'Enter requested value...'
                  }
                  autoFocus
                  className="flex-1 rounded-lg border border-amber-600/70 bg-zinc-950 px-3.5 py-2 font-mono text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-amber-400 transition-colors"
                />
                <button
                  type="button"
                  onClick={handleSubmitRuntimeInput}
                  disabled={!runtimeInputValue.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-400 px-3.5 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-300 transition-colors disabled:opacity-40 shrink-0 shadow-sm"
                >
                  <Send size={13} />
                  <span>Submit to Agent</span>
                </button>
              </div>
            </div>
          )}

          {/* Ad-Hoc Command Input */}
          <div className="border-t border-zinc-800/80 bg-[#0d0d10] p-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Send an ad-hoc directive to engine (Enter to submit)..."
                disabled={isBusy}
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2 font-mono text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600 transition-colors disabled:opacity-50"
              />
              <button
                onClick={handleExecute}
                disabled={!input.trim() || isBusy}
                className="rounded-lg bg-zinc-100 p-2 text-zinc-900 hover:bg-white transition-colors disabled:opacity-40"
                title="Dispatch"
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
