/**
 * AgentDashboard.jsx - Persistent Agent Registry & Audit Explorer
 *
 * High-density management console for agents stored in SQLite database.
 * Supports running workflows, reviewing execution history logs, and managing records.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Play,
  List,
  Trash2,
  Clock,
  Activity,
  X,
  Search,
  Database,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  FileText,
} from 'lucide-react';
import useStore from '../hooks/useStore';
import useTauri from '../hooks/useTauri';

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

export default function AgentDashboard({ onSwitchToChat }) {
  const agents = useStore((s) => s.agents);
  const setAgents = useStore((s) => s.setAgents);
  const setCurrentAgent = useStore((s) => s.setCurrentAgent);
  const executionLogs = useStore((s) => s.executionLogs);
  const setExecutionLogs = useStore((s) => s.setExecutionLogs);

  const { getAgents, getExecutionHistory, deleteAgent } = useTauri();

  const [search, setSearch] = useState('');
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await getAgents();
      if (data) setAgents(data);
      setLoading(false);
    })();
  }, [getAgents, setAgents]);

  const handleRun = useCallback(
    (agent) => {
      setCurrentAgent(agent);
      onSwitchToChat?.();
    },
    [setCurrentAgent, onSwitchToChat]
  );

  const handleViewLogs = useCallback(
    async (agent) => {
      setSelectedAgent(agent);
      const { data } = await getExecutionHistory(agent.id);
      setExecutionLogs(data || []);
    },
    [getExecutionHistory, setExecutionLogs]
  );

  const handleDelete = useCallback(
    async (agent) => {
      await deleteAgent(agent.id);
      const { data } = await getAgents();
      if (data) setAgents(data);
      else setAgents(agents.filter((a) => a.id !== agent.id));
      if (selectedAgent?.id === agent.id) {
        setSelectedAgent(null);
      }
    },
    [deleteAgent, getAgents, agents, setAgents, selectedAgent]
  );

  const filteredAgents = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.description && a.description.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex h-full flex-col bg-[#09090b] text-zinc-200">
      {/* ── Sub Header ────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/80 bg-[#0d0d10] px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-zinc-400" />
            <h2 className="text-sm font-semibold text-zinc-100">SQLite Agent Registry</h2>
          </div>
          <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-400">
            {agents.length} saved
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-2.5 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents..."
              className="rounded-lg border border-zinc-800 bg-zinc-950 pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-700 transition-colors w-48 sm:w-64"
            />
          </div>
        </div>
      </div>

      {/* ── Main Content Area ─────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Table / Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex h-64 items-center justify-center text-xs text-zinc-500">
              Loading registry records...
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-center text-zinc-500">
              <Database size={36} className="mb-2 text-zinc-700" />
              <p className="text-sm font-medium text-zinc-400">No agents found</p>
              <p className="mt-1 text-xs text-zinc-600">
                Execute a task from the console to automatically persist an agent record.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {filteredAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex flex-col justify-between rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-4 transition-all hover:border-zinc-700 hover:bg-zinc-900/60"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="truncate text-xs font-semibold text-zinc-100">
                        {agent.name}
                      </h3>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-medium uppercase ${
                          agent.status === 'running'
                            ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/40'
                            : agent.status === 'paused'
                            ? 'bg-amber-950/40 text-amber-400 border border-amber-800/40'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {agent.status}
                      </span>
                    </div>

                    <p className="mt-2 line-clamp-2 text-[11px] text-zinc-400 leading-relaxed">
                      {agent.description || 'No description provided.'}
                    </p>

                    <div className="mt-3 flex items-center gap-3 text-[10px] font-mono text-zinc-500">
                      <span>ID: {agent.id.slice(0, 8)}</span>
                      <span>Created: {timeAgo(agent.createdAt)}</span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-zinc-800/60 pt-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRun(agent)}
                        className="flex items-center gap-1 rounded bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
                      >
                        <Play size={10} fill="currentColor" />
                        Execute
                      </button>

                      <button
                        onClick={() => handleViewLogs(agent)}
                        className="flex items-center gap-1 rounded border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                      >
                        <List size={11} />
                        Audit
                      </button>
                    </div>

                    <button
                      onClick={() => handleDelete(agent)}
                      className="rounded p-1 text-zinc-500 hover:bg-rose-950/40 hover:text-rose-400 transition-colors"
                      title="Delete record"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Audit Log Drawer (when selected) */}
        {selectedAgent && (
          <div className="flex w-96 flex-col border-l border-zinc-800 bg-[#0c0c0f]">
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
              <div>
                <h3 className="text-xs font-semibold text-zinc-100">Audit Trail</h3>
                <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                  {selectedAgent.name}
                </p>
              </div>
              <button
                onClick={() => setSelectedAgent(null)}
                className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {executionLogs.length === 0 ? (
                <p className="py-12 text-center text-xs text-zinc-600">
                  No execution logs recorded yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {executionLogs.map((log, i) => (
                    <div
                      key={log.id || i}
                      className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5 font-mono text-[11px]"
                    >
                      <div className="flex items-center justify-between text-[10px] text-zinc-500">
                        <span>{log.step || 'Execution Step'}</span>
                        <span
                          className={
                            log.status === 'success'
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }
                        >
                          {log.status}
                        </span>
                      </div>
                      <p className="mt-1 text-zinc-300 font-sans text-xs">
                        {log.summary || log.detail || 'Step completed'}
                      </p>
                      <span className="mt-1.5 block text-[10px] text-zinc-600">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
