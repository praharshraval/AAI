/**
 * AgentDashboard.jsx - Dashboard for saved agents and health metrics.
 *
 * Displays agents in a responsive glass-card grid with status badges,
 * relative timestamps, and action buttons.  Includes an execution-log
 * slide-out panel triggered per agent.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Play, List, Trash2, Bot, Clock, Activity, X } from 'lucide-react';
import useStore from '../hooks/useStore';
import useTauri from '../hooks/useTauri';

// ─── Helpers ───────────────────────────────────────────────────────────

/** Convert an ISO string to a relative "time ago" label. */
function timeAgo(iso) {
  if (!iso) return '';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Status badge config. */
const BADGE = {
  idle: { bg: 'bg-gray-600/40', text: 'text-gray-300', dot: 'bg-gray-400', label: 'Idle' },
  running: { bg: 'bg-green-600/20', text: 'text-green-300', dot: 'bg-green-400 animate-pulse', label: 'Running' },
  paused: { bg: 'bg-yellow-600/20', text: 'text-yellow-300', dot: 'bg-yellow-400', label: 'Paused' },
  error: { bg: 'bg-red-600/20', text: 'text-red-300', dot: 'bg-red-500', label: 'Error' },
};

// ─── Agent Card ────────────────────────────────────────────────────────

function AgentCard({ agent, onRun, onViewLogs, onDelete }) {
  const badge = BADGE[agent.status] ?? BADGE.idle;

  return (
    <div className="group relative rounded-2xl border border-gray-700/50 bg-gray-800/40 backdrop-blur-lg p-5 shadow-lg transition-all duration-200 hover:border-gray-600 hover:shadow-xl hover:bg-gray-800/60">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400">
            <Bot size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-gray-100">
              {agent.name}
            </h3>
            <span
              className={`mt-0.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.bg} ${badge.text}`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${badge.dot}`} />
              {badge.label}
            </span>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-gray-400">
        {agent.description || 'No description provided.'}
      </p>

      {/* Meta */}
      <div className="mt-4 flex items-center gap-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1">
          <Clock size={11} />
          {timeAgo(agent.createdAt)}
        </span>
        {agent.lastRun && (
          <span className="flex items-center gap-1">
            <Activity size={11} />
            Run {timeAgo(agent.lastRun)}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2 border-t border-gray-700/40 pt-3">
        <button
          onClick={() => onRun(agent)}
          className="flex items-center gap-1.5 rounded-lg bg-green-600/20 px-3 py-1.5 text-xs font-medium text-green-300 transition-colors hover:bg-green-600/40"
          title="Run agent"
        >
          <Play size={12} /> Run
        </button>
        <button
          onClick={() => onViewLogs(agent)}
          className="flex items-center gap-1.5 rounded-lg bg-gray-700/30 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700/50"
          title="View execution logs"
        >
          <List size={12} /> Logs
        </button>
        <button
          onClick={() => onDelete(agent)}
          className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-gray-500 transition-colors hover:bg-red-600/20 hover:text-red-400"
          title="Delete agent"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── Execution Log Panel ───────────────────────────────────────────────

function LogPanel({ agent, logs, onClose }) {
  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-gray-700/50 bg-gray-900/95 backdrop-blur-xl shadow-2xl">
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">
            Execution History
          </h3>
          <p className="mt-0.5 text-xs text-gray-500 truncate">
            {agent.name}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
        >
          <X size={16} />
        </button>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {logs.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-500">
            No execution history yet.
          </p>
        ) : (
          <ol className="relative border-l border-gray-700/60 ml-2">
            {logs.map((log, i) => (
              <li key={log.id ?? i} className="mb-6 ml-6">
                <span className="absolute -left-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-gray-700 ring-4 ring-gray-900">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      log.status === 'success'
                        ? 'bg-green-400'
                        : log.status === 'error'
                        ? 'bg-red-400'
                        : 'bg-blue-400'
                    }`}
                  />
                </span>
                <time className="mb-1 block text-[10px] text-gray-500">
                  {new Date(log.timestamp).toLocaleString()}
                </time>
                <p className="text-xs text-gray-300">{log.summary ?? log.step}</p>
                {log.detail && (
                  <p className="mt-1 text-[11px] text-gray-500">{log.detail}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────

export default function AgentDashboard({ onSwitchToChat }) {
  const agents = useStore((s) => s.agents);
  const setAgents = useStore((s) => s.setAgents);
  const setCurrentAgent = useStore((s) => s.setCurrentAgent);
  const executionLogs = useStore((s) => s.executionLogs);
  const setExecutionLogs = useStore((s) => s.setExecutionLogs);

  const { getAgents, getExecutionHistory, deleteAgent } = useTauri();

  const [logAgent, setLogAgent] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch agents on mount.
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await getAgents();
      if (data) setAgents(data);
      setLoading(false);
    })();
  }, [getAgents, setAgents]);

  // ── Actions ─────────────────────────────────────────────────────

  const handleRun = useCallback(
    (agent) => {
      setCurrentAgent(agent);
      onSwitchToChat?.();
    },
    [setCurrentAgent, onSwitchToChat]
  );

  const handleViewLogs = useCallback(
    async (agent) => {
      const { data } = await getExecutionHistory(agent.id);
      setExecutionLogs(data ?? []);
      setLogAgent(agent);
    },
    [getExecutionHistory, setExecutionLogs]
  );

  const handleDelete = useCallback(
    async (agent) => {
      await deleteAgent(agent.id);
      const { data } = await getAgents();
      if (data) setAgents(data);
      else setAgents(agents.filter((a) => a.id !== agent.id));
    },
    [deleteAgent, getAgents, agents, setAgents]
  );

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div className="relative h-full overflow-y-auto px-6 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-gray-100">Agent Library</h2>
          <span className="rounded-full bg-indigo-600/20 px-2.5 py-0.5 text-xs font-medium text-indigo-300">
            {agents.length}
          </span>
        </div>
      </div>

      {/* Grid / Empty State */}
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-indigo-400" />
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-gray-500">
          <Bot size={56} strokeWidth={1} className="mb-4 text-gray-600" />
          <p className="text-lg font-medium text-gray-400">No agents yet</p>
          <p className="mt-1 text-sm">
            Create one from the <span className="text-blue-400">Chat</span> tab.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onRun={handleRun}
              onViewLogs={handleViewLogs}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Slide-out log panel */}
      {logAgent && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm"
            onClick={() => setLogAgent(null)}
          />
          <LogPanel
            agent={logAgent}
            logs={executionLogs}
            onClose={() => setLogAgent(null)}
          />
        </>
      )}
    </div>
  );
}
