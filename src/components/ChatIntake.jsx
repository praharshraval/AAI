/**
 * ChatIntake.jsx - Main chat interface for prompt intake and agent interaction.
 *
 * Renders a scrollable message history, a multiline prompt input, sidecar status,
 * inline guardrail feedback, and collapsible JSON manifest viewers.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Bot,
  User,
  AlertTriangle,
  CheckCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import useStore from '../hooks/useStore';
import useTauri from '../hooks/useTauri';

// ─── Helpers ───────────────────────────────────────────────────────────

/** Format an ISO timestamp to a short locale string. */
function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** Map sidecar status to a Tailwind dot colour and label. */
const STATUS_MAP = {
  idle: { color: 'bg-gray-400', label: 'Idle' },
  running: { color: 'bg-green-400 animate-pulse', label: 'Running' },
  paused: { color: 'bg-yellow-400', label: 'Paused' },
  error: { color: 'bg-red-500', label: 'Error' },
};

// ─── Sub-components ────────────────────────────────────────────────────

/** Collapsible JSON manifest viewer. */
function ManifestViewer({ content }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2 rounded-lg border border-gray-700 bg-gray-900/70 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800/50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <CheckCircle size={14} className="text-green-400" />
          Generated Manifest
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <pre className="overflow-x-auto px-4 py-3 text-xs leading-relaxed text-emerald-300 bg-gray-950/60 font-mono max-h-96 overflow-y-auto">
          <code>{content}</code>
        </pre>
      )}
    </div>
  );
}

/** Guardrail rejection alert card. */
function GuardrailAlert({ reason }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-700/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-400" />
      <div>
        <p className="font-semibold text-red-200">Prompt Rejected</p>
        <p className="mt-1">{reason}</p>
      </div>
    </div>
  );
}

/** Single chat message bubble. */
function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';

  // ── System messages (centered) ──────────────────────────────────
  if (isSystem) {
    if (msg.isGuardrailReject) {
      return (
        <div className="mx-auto max-w-2xl my-2">
          <GuardrailAlert reason={msg.content} />
        </div>
      );
    }

    return (
      <div className="flex justify-center my-2">
        <div
          className={`max-w-md rounded-lg px-4 py-2 text-center text-xs ${
            msg.isError
              ? 'bg-red-900/30 border border-red-700/40 text-red-300'
              : 'bg-yellow-900/20 border border-yellow-700/30 text-yellow-300'
          }`}
        >
          {msg.content === '...' ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={12} className="animate-spin" />
              Thinking…
            </span>
          ) : (
            msg.content
          )}
          <span className="block mt-1 text-[10px] opacity-50">
            {formatTime(msg.timestamp)}
          </span>
        </div>
      </div>
    );
  }

  // ── User / Assistant bubbles ────────────────────────────────────
  return (
    <div
      className={`flex items-end gap-2 my-2 ${
        isUser ? 'justify-end' : 'justify-start'
      }`}
    >
      {/* Avatar */}
      {!isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600/30 text-indigo-300">
          <Bot size={14} />
        </div>
      )}

      <div
        className={`relative max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-md ${
          isUser
            ? 'bg-blue-600 text-white rounded-br-md'
            : 'bg-gray-800/80 text-gray-200 rounded-bl-md border border-gray-700/50'
        }`}
      >
        {/* Manifest viewer */}
        {msg.isManifest ? (
          <ManifestViewer content={msg.content} />
        ) : (
          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        )}
        <span
          className={`mt-1 block text-[10px] ${
            isUser ? 'text-blue-200/60 text-right' : 'text-gray-500'
          }`}
        >
          {formatTime(msg.timestamp)}
        </span>
      </div>

      {isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600/30 text-blue-300">
          <User size={14} />
        </div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────

export default function ChatIntake() {
  const chatMessages = useStore((s) => s.chatMessages);
  const sidecarStatus = useStore((s) => s.sidecarStatus);
  const addChatMessage = useStore((s) => s.addChatMessage);

  const { startSidecar, getApiKey } = useTauri();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const isBusy = sidecarStatus === 'running' || sidecarStatus === 'paused';
  const canSend = input.trim().length > 0 && !isBusy;
  const status = STATUS_MAP[sidecarStatus] ?? STATUS_MAP.idle;

  // Auto-scroll to the latest message.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Auto-resize textarea up to a max height.
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 160) + 'px';
    }
  }, [input]);

  // ── Submit handler ──────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isBusy) return;

    // 1. Add user message
    addChatMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    });

    // 2. Add thinking indicator
    addChatMessage({
      id: crypto.randomUUID(),
      role: 'system',
      content: '...',
      timestamp: new Date().toISOString(),
    });

    setInput('');

    // 3. Retrieve API key (optional override; Rust backend also checks native Keyring/Vault)
    const { data: apiKey } = await getApiKey();

    const { data: agent, error: scErr } = await startSidecar(trimmed, apiKey || null);
    if (scErr) {
      addChatMessage({
        id: crypto.randomUUID(),
        role: 'system',
        content: `⚠️ ${scErr}`,
        timestamp: new Date().toISOString(),
        isError: true,
      });
    } else if (agent) {
      addChatMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `🤖 Agent **${agent.name}** created and queued for execution. Evaluating ethical safety and generating task manifest...`,
        timestamp: new Date().toISOString(),
      });
    }
  }, [input, isBusy, addChatMessage, getApiKey, startSidecar]);

  // ── Keyboard shortcut: Enter to send, Shift+Enter for newline ──
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">
      {/* ── Message History ──────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-6 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-700">
        {chatMessages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-gray-500">
            <Bot size={48} strokeWidth={1} className="mb-4 text-gray-600" />
            <p className="text-lg font-medium text-gray-400">
              Start a conversation
            </p>
            <p className="mt-1 text-sm">
              Describe the automation task you'd like to build.
            </p>
          </div>
        )}

        {chatMessages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input Area ───────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-gray-800 bg-gray-900/60 backdrop-blur-md px-4 py-3">
        {/* Status bar */}
        <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${status.color}`} />
            {status.label}
          </span>
          <span>{input.length} / 4000</span>
        </div>

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 4000))}
            onKeyDown={handleKeyDown}
            placeholder="Describe your automation task..."
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-700 bg-gray-800/70 px-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
          />

          <button
            onClick={handleSubmit}
            disabled={!canSend}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-blue-600"
            title="Send message"
          >
            {isBusy ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
