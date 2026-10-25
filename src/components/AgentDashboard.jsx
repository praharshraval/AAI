/**
 * AgentDashboard.jsx - Persistent Agent Library & Execution Dispatcher
 *
 * Displays agents stored in SQLite with real-time status badges, capabilities,
 * 1-click execution dispatch, and "+ Create New Agent" flow.
 * Free of mock/dummy data.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Play,
  List,
  Trash2,
  Clock,
  Plus,
  Search,
  Database,
  ExternalLink,
  Bot,
  Activity,
  X,
  FileCode,
  Layers,
} from 'lucide-react';
import useStore from '../hooks/useStore';
import useTauri from '../hooks/useTauri';
import CreateAgentModal from './CreateAgentModal';

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

export default function AgentDashboard({ onRunAgent, isCreateModalOpen, setIsCreateModalOpen }) {
  const agents = useStore((s) => s.agents);
  const setAgents = useStore((s) => s.setAgents);
  const executionLogs = useStore((s) => s.executionLogs);
  const setExecutionLogs = useStore((s) => s.setExecutionLogs);

  const { getAgents, getExecutionHistory, deleteAgent } = useTauri();

  const [search, setSearch] = useState('');
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [manifestModalAgent, setManifestModalAgent] = useState(null);

  const refreshAgents = useCallback(async () => {
    setLoading(true);
    const { data } = await getAgents();
    if (data) setAgents(data);
    setLoading(false);
  }, [getAgents, setAgents]);

  useEffect(() => {
    refreshAgents();
  }, [refreshAgents]);

  const handleViewLogs = async (agent) => {
    setSelectedAgent(agent);
    const { data } = await getExecutionHistory(agent.id);
    setExecutionLogs(data || []);
  };

  const handleDelete = async (agent) => {
    await deleteAgent(agent.id);
    const { data } = await getAgents();
    if (data) setAgents(data);
    else setAgents(agents.filter((a) => a.id !== agent.id));
    if (selectedAgent?.id === agent.id) {
      setSelectedAgent(null);
    }
  };

  const filteredAgents = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.description && a.description.toLowerCase().includes(search.toLowerCase())) ||
      (a.prompt && a.prompt.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex h-full flex-col bg-[#09090b] text-zinc-200">
      {/* ── Sub Header / Controls ─────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/80 bg-[#0d0d10] px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Database size={15} className="text-zinc-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Configured Autonomous Agents</h2>
          </div>
          <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-400">
            {agents.length} active
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-2.5 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter agents..."
              className="rounded-lg border border-zinc-800 bg-zinc-950 pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-700 transition-colors w-40 sm:w-56"
            />
          </div>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3.5 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white transition-colors shadow-sm"
          >
            <Plus size={14} />
            <span>Create New Agent</span>
          </button>
        </div>
      </div>

      {/* ── Main Content Area ─────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Table / Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex h-64 items-center justify-center text-xs text-zinc-500 font-mono">
              Querying SQLite registry...
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="flex h-80 flex-col items-center justify-center text-center text-zinc-500">
              <Bot size={40} className="mb-3 text-zinc-700" />
              <p className="text-sm font-medium text-zinc-300">No agents in registry</p>
              <p className="mt-1 text-xs text-zinc-500 max-w-sm leading-relaxed">
                Provide a prompt requirement to construct and register an autonomous multi-agent system.
              </p>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-900 hover:bg-white transition-colors"
              >
                <Plus size={14} />
                <span>Create Your First Agent</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredAgents.map((agent) => {
                let manifest = {};
                try {
                  manifest = JSON.parse(agent.manifest_json || '{}');
                } catch {
                  /* ignore */
                }

                return (
                  <div
                    key={agent.id}
                    className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-[#0d0d11] p-4 transition-all hover:border-zinc-700 hover:bg-zinc-900/40"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded bg-zinc-800 text-zinc-300">
                            <Bot size={14} />
                          </div>
                          <h3 className="truncate text-xs font-semibold text-zinc-100">
                            {agent.name}
                          </h3>
                        </div>
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

                      <p className="mt-2.5 line-clamp-2 text-xs text-zinc-400 leading-relaxed">
                        {agent.description || agent.prompt}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-mono text-zinc-500">
                        {manifest.steps && (
                          <span className="rounded bg-zinc-900 border border-zinc-800 px-2 py-0.5">
                            {manifest.steps.length} Steps
                          </span>
                        )}
                        <span className="rounded bg-zinc-900 border border-zinc-800 px-2 py-0.5">
                          Created {timeAgo(agent.created_at)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-zinc-800/80 pt-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onRunAgent(agent)}
                          className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors shadow-sm"
                        >
                          <Play size={11} fill="currentColor" />
                          <span>Run Agent</span>
                        </button>

                        <button
                          onClick={() => setManifestModalAgent(agent)}
                          className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                          title="View Manifest"
                        >
                          <FileCode size={12} />
                          <span>Plan</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleViewLogs(agent)}
                          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
                          title="View execution audit logs"
                        >
                          <List size={13} />
                        </button>

                        <button
                          onClick={() => handleDelete(agent)}
                          className="rounded p-1.5 text-zinc-500 hover:bg-rose-950/40 hover:text-rose-400 transition-colors"
                          title="Delete agent record"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
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
                <p className="py-12 text-center text-xs text-zinc-600 font-mono">
                  No execution logs recorded yet.
                </p>
              ) : (
                <div className="space-y-3 font-mono text-xs">
                  {executionLogs.map((log, i) => (
                    <div
                      key={log.id || i}
                      className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5 text-[11px]"
                    >
                      <div className="flex items-center justify-between text-[10px] text-zinc-500">
                        <span>{log.step || 'Step'}</span>
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
                        {log.summary || log.detail || 'Completed'}
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

        {/* Manifest Inspector Modal */}
        {manifestModalAgent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm select-none">
            <div className="w-full max-w-xl rounded-xl border border-zinc-800 bg-[#0d0d11] p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <FileCode size={16} className="text-zinc-400" />
                  <h3 className="text-xs font-semibold text-zinc-200">
                    Execution Manifest: {manifestModalAgent.name}
                  </h3>
                </div>
                <button
                  onClick={() => setManifestModalAgent(null)}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="mt-4 max-h-96 overflow-y-auto">
                <pre className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs text-zinc-300 overflow-x-auto leading-relaxed">
                  {JSON.stringify(JSON.parse(manifestModalAgent.manifest_json || '{}'), null, 2)}
                </pre>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => setManifestModalAgent(null)}
                  className="rounded-lg bg-zinc-800 px-4 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Create Agent Modal */}
        <CreateAgentModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onAgentCreated={(newAgent) => {
            refreshAgents();
            // Automatically prompt to run the new agent
            onRunAgent(newAgent);
          }}
        />
      </div>
    </div>
  );
}
