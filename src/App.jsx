/**
 * App.jsx - Main application shell for the RPA Agent Platform.
 *
 * Provides the dark-themed layout with a collapsible sidebar, top bar,
 * and conditional rendering of modals and content panels.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  Bot,
  Settings,
  Cpu,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import useStore from './hooks/useStore';
import useTauri from './hooks/useTauri';
import ChatIntake from './components/ChatIntake';
import AgentDashboard from './components/AgentDashboard';
import PreviewModal from './components/PreviewModal';
import SettingsModal from './components/SettingsModal';

// ─── Sidebar nav items ────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'agents', label: 'Agents', icon: Bot },
];

// ─── Sidecar status config ─────────────────────────────────────────────

const STATUS_CONFIG = {
  idle: { color: 'bg-gray-400', text: 'text-gray-400', label: 'Idle' },
  running: {
    color: 'bg-green-400 animate-pulse',
    text: 'text-green-400',
    label: 'Running',
  },
  paused: { color: 'bg-yellow-400', text: 'text-yellow-300', label: 'Paused' },
  error: { color: 'bg-red-500', text: 'text-red-400', label: 'Error' },
};

// ─── Main App ──────────────────────────────────────────────────────────

export default function App() {
  const sidecarStatus = useStore((s) => s.sidecarStatus);
  const isPreviewOpen = useStore((s) => s.isPreviewOpen);
  const updateSettings = useStore((s) => s.updateSettings);

  const { hasApiKey, runPreflightCheck } = useTauri();

  const [activeTab, setActiveTab] = useState('chat');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);

  const statusCfg = STATUS_CONFIG[sidecarStatus] ?? STATUS_CONFIG.idle;

  // ── Initialisation: check API key & run preflight ───────────────
  useEffect(() => {
    (async () => {
      const { data: hasKey } = await hasApiKey();
      updateSettings({ apiKeyConfigured: !!hasKey });

      const { data: pf } = await runPreflightCheck();
      if (pf) updateSettings({ preflightStatus: pf });
    })();
    // Run only once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchToChat = useCallback(() => setActiveTab('chat'), []);

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-950 text-gray-100 select-none">
      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside
        className={`flex flex-col border-r border-gray-800/60 bg-gray-900/70 backdrop-blur-xl transition-all duration-300 ${
          sidebarExpanded ? 'w-56' : 'w-16'
        }`}
      >
        {/* Logo area */}
        <div className="flex h-14 items-center gap-2.5 border-b border-gray-800/60 px-4">
          <Cpu size={20} className="shrink-0 text-indigo-400" />
          {sidebarExpanded && (
            <span className="truncate text-sm font-bold tracking-tight text-gray-100">
              RPA Platform
            </span>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 space-y-1 px-2 py-3">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  active
                    ? 'bg-indigo-600/20 text-indigo-300 shadow-sm'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                }`}
                title={label}
              >
                <Icon size={18} className="shrink-0" />
                {sidebarExpanded && <span>{label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Bottom controls */}
        <div className="space-y-1 border-t border-gray-800/60 px-2 py-3">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-400 transition-all hover:bg-gray-800/50 hover:text-gray-200"
            title="Settings"
          >
            <Settings size={18} className="shrink-0" />
            {sidebarExpanded && <span>Settings</span>}
          </button>

          <button
            onClick={() => setSidebarExpanded(!sidebarExpanded)}
            className="flex w-full items-center justify-center rounded-xl py-2 text-gray-500 transition-colors hover:bg-gray-800/50 hover:text-gray-300"
            title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarExpanded ? (
              <ChevronLeft size={16} />
            ) : (
              <ChevronRight size={16} />
            )}
          </button>
        </div>
      </aside>

      {/* ── Main Area ────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-800/60 bg-gray-900/40 backdrop-blur-md px-6">
          <h1 className="text-sm font-semibold text-gray-300 tracking-wide">
            {activeTab === 'chat' ? 'Chat · Prompt Intake' : 'Agent Library'}
          </h1>

          <div className="flex items-center gap-4">
            {/* Sidecar status */}
            <div className="flex items-center gap-2 rounded-full bg-gray-800/60 px-3 py-1.5 text-xs">
              <span
                className={`inline-block h-2 w-2 rounded-full ${statusCfg.color}`}
              />
              <span className={statusCfg.text}>
                Sidecar: {statusCfg.label}
              </span>
            </div>

            {/* Settings button */}
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800/60 hover:text-gray-200"
              title="Settings"
            >
              <Settings size={16} />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-hidden">
          {activeTab === 'chat' && <ChatIntake />}
          {activeTab === 'agents' && (
            <AgentDashboard onSwitchToChat={switchToChat} />
          )}
        </main>
      </div>

      {/* ── Modals ───────────────────────────────────────────────── */}
      {isPreviewOpen && <PreviewModal />}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
