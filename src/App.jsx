/**
 * App.jsx - Main application shell for the RPA Agent Platform.
 *
 * Provides a high-performance desktop engineering layout with collapsible navigation,
 * real-time engine telemetry, and clean window chrome.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Terminal,
  Database,
  Settings,
  Activity,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import useStore from './hooks/useStore';
import useTauri from './hooks/useTauri';
import ChatIntake from './components/ChatIntake';
import AgentDashboard from './components/AgentDashboard';
import PreviewModal from './components/PreviewModal';
import SettingsModal from './components/SettingsModal';

const NAV_ITEMS = [
  { id: 'chat', label: 'Console & Orchestration', icon: Terminal },
  { id: 'agents', label: 'Agent Registry', icon: Database },
];

export default function App() {
  const sidecarStatus = useStore((s) => s.sidecarStatus);
  const isPreviewOpen = useStore((s) => s.isPreviewOpen);
  const updateSettings = useStore((s) => s.updateSettings);

  const { hasApiKey, runPreflightCheck } = useTauri();

  const [activeTab, setActiveTab] = useState('chat');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: hasKey } = await hasApiKey();
      updateSettings({ apiKeyConfigured: !!hasKey });

      const { data: pf } = await runPreflightCheck();
      if (pf) updateSettings({ preflightStatus: pf });
    })();
  }, [hasApiKey, runPreflightCheck, updateSettings]);

  const switchToChat = useCallback(() => setActiveTab('chat'), []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#09090b] text-zinc-100 select-none font-sans">
      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside
        className={`flex flex-col border-r border-zinc-800 bg-[#0d0d10] transition-all duration-200 ${
          sidebarExpanded ? 'w-56' : 'w-14'
        }`}
      >
        {/* Logo / Brand Header */}
        <div className="flex h-12 items-center gap-2.5 border-b border-zinc-800 px-3.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-zinc-100 text-zinc-900 font-bold font-mono text-xs">
            A
          </div>
          {sidebarExpanded && (
            <div className="min-w-0">
              <span className="truncate text-xs font-bold tracking-tight text-zinc-100">
                AAI Platform
              </span>
              <span className="block text-[9px] font-mono text-zinc-500 uppercase">
                Desktop RPA v2.4
              </span>
            </div>
          )}
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 space-y-1 p-2">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                }`}
                title={label}
              >
                <Icon size={15} className="shrink-0" />
                {sidebarExpanded && <span className="truncate">{label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Bottom Actions */}
        <div className="border-t border-zinc-800 p-2 space-y-1">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 transition-colors"
            title="Settings & System Diagnostics"
          >
            <Settings size={15} className="shrink-0" />
            {sidebarExpanded && <span>Settings</span>}
          </button>

          <button
            onClick={() => setSidebarExpanded(!sidebarExpanded)}
            className="flex w-full items-center justify-center rounded-lg py-1.5 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300 transition-colors"
            title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarExpanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
      </aside>

      {/* ── Main Work Area ────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Header */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 bg-[#0d0d10] px-6">
          <div className="flex items-center gap-3 text-xs">
            <span className="font-semibold text-zinc-200">
              {activeTab === 'chat'
                ? 'Automation Console & Orchestration'
                : 'Persistent Agent Registry'}
            </span>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-500 font-mono text-[11px]">
              Local-First Desktop Engine
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-xs">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  sidecarStatus === 'running'
                    ? 'bg-emerald-400 animate-pulse'
                    : sidecarStatus === 'paused'
                    ? 'bg-amber-400'
                    : sidecarStatus === 'error'
                    ? 'bg-rose-500'
                    : 'bg-zinc-500'
                }`}
              />
              <span className="font-mono text-[11px] text-zinc-300 capitalize">
                {sidecarStatus}
              </span>
            </div>

            <button
              onClick={() => setIsSettingsOpen(true)}
              className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
              title="Settings"
            >
              <Settings size={15} />
            </button>
          </div>
        </header>

        {/* Active Panel */}
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
