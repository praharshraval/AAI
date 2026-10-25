/**
 * App.jsx - Main Application Shell & Onboarding Router
 *
 * Implements the explicit user lifecycle:
 * 1. Initial Account Creation ("Create an Account")
 * 2. Gemini API Key Configuration & Live Validation
 * 3. Main Dashboard with "+ Create New Agent" Requirement Analysis & Live Execution
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  Terminal,
  Settings,
  Plus,
  Key,
  Shield,
  LogOut,
  User,
  ChevronDown,
} from 'lucide-react';
import useStore from './hooks/useStore';
import useTauri from './hooks/useTauri';

import CreateAccountScreen from './components/CreateAccountScreen';
import ApiKeySetupScreen from './components/ApiKeySetupScreen';
import AgentDashboard from './components/AgentDashboard';
import ChatIntake from './components/ChatIntake';
import PreviewModal from './components/PreviewModal';
import SettingsModal from './components/SettingsModal';
import CreateAgentModal from './components/CreateAgentModal';

export default function App() {
  const sidecarStatus = useStore((s) => s.sidecarStatus);
  const isPreviewOpen = useStore((s) => s.isPreviewOpen);
  const updateSettings = useStore((s) => s.updateSettings);

  const { hasApiKey, getApiKey, startSidecar } = useTauri();

  // Screen routing: 'create-account' | 'api-key-setup' | 'dashboard'
  const [screen, setScreen] = useState('loading');
  const [activeTab, setActiveTab] = useState('agents'); // 'agents' | 'console'
  const [account, setAccount] = useState(null);
  const [activeRunningAgent, setActiveRunningAgent] = useState(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  // Initial Onboarding Check
  useEffect(() => {
    (async () => {
      const storedAccount = localStorage.getItem('rpa_account');
      if (!storedAccount) {
        setScreen('create-account');
        return;
      }

      try {
        setAccount(JSON.parse(storedAccount));
      } catch {
        /* ignore */
      }

      // Check if API key is stored & valid
      const { data: hasKey } = await hasApiKey();
      const { data: keyVal } = await getApiKey();

      if (!hasKey || !keyVal || keyVal.trim() === '' || keyVal === 'local-mode') {
        setScreen('api-key-setup');
      } else {
        updateSettings({ apiKeyConfigured: true });
        setScreen('dashboard');
      }
    })();
  }, [hasApiKey, getApiKey, updateSettings]);

  // Account creation callback
  const handleAccountCreated = (newAccount) => {
    setAccount(newAccount);
    setScreen('api-key-setup');
  };

  // API key validated callback
  const handleKeyValidated = (key) => {
    updateSettings({ apiKeyConfigured: key !== 'local-mode' });
    setScreen('dashboard');
  };

  // Run Agent handler
  const handleRunAgent = async (agent) => {
    setActiveRunningAgent(agent);
    setActiveTab('console');

    const { data: apiKey } = await getApiKey();
    await startSidecar(agent.prompt, apiKey || 'local-mode');
  };

  const handleResetAccount = () => {
    localStorage.removeItem('rpa_account');
    setAccount(null);
    setScreen('create-account');
    setUserDropdownOpen(false);
  };

  // Loading Screen
  if (screen === 'loading') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#09090b] text-zinc-400 font-mono text-xs">
        Initializing AAI Desktop Engine...
      </div>
    );
  }

  // 1. Initial Account Creation Screen
  if (screen === 'create-account') {
    return <CreateAccountScreen onAccountCreated={handleAccountCreated} />;
  }

  // 2. Gemini API Key Setup & Validation Screen
  if (screen === 'api-key-setup') {
    return <ApiKeySetupScreen onKeyValidated={handleKeyValidated} />;
  }

  // 3. Main Dashboard & Workspace
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#09090b] text-zinc-100 select-none font-sans">
      {/* ── Main Top Bar ────────────────────────────────────────── */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 bg-[#0d0d10] px-5">
        {/* Left Branding & Tabs */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-zinc-100 font-mono text-xs font-bold text-zinc-900">
              A
            </div>
            <div>
              <span className="text-xs font-bold tracking-tight text-zinc-100">
                AAI Platform
              </span>
              <span className="ml-2 font-mono text-[10px] text-zinc-500 uppercase">
                Enterprise Desktop RPA
              </span>
            </div>
          </div>

          <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950/60 p-0.5 text-xs">
            <button
              onClick={() => setActiveTab('agents')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors ${
                activeTab === 'agents'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Database size={13} />
              <span>Agent Library</span>
            </button>

            <button
              onClick={() => setActiveTab('console')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors ${
                activeTab === 'console'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Terminal size={13} />
              <span>Execution Console</span>
              {sidecarStatus === 'running' && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>
          </div>
        </div>

        {/* Right CTA & Account Info */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white transition-colors shadow-sm"
          >
            <Plus size={14} />
            <span>Create New Agent</span>
          </button>

          {/* Engine Status Tag */}
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
            <span className="font-mono text-[10px] text-zinc-400 capitalize">
              {sidecarStatus}
            </span>
          </div>

          {/* User Account / Profile Chip */}
          <div className="relative">
            <button
              onClick={() => setUserDropdownOpen(!userDropdownOpen)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-700 transition-colors"
            >
              <User size={13} className="text-zinc-400" />
              <span className="max-w-[120px] truncate">{account?.name || 'Administrator'}</span>
              <ChevronDown size={11} className="text-zinc-500" />
            </button>

            {userDropdownOpen && (
              <div className="absolute right-0 mt-1.5 w-52 rounded-xl border border-zinc-800 bg-[#0d0d11] p-1.5 shadow-2xl z-50 text-xs">
                <div className="border-b border-zinc-800/80 px-2.5 py-2">
                  <p className="font-semibold text-zinc-200">{account?.name}</p>
                  <p className="text-[10px] text-zinc-500 truncate">{account?.org}</p>
                </div>

                <div className="py-1">
                  <button
                    onClick={() => {
                      setUserDropdownOpen(false);
                      setIsSettingsOpen(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    <Settings size={13} />
                    <span>Settings & API Key</span>
                  </button>

                  <button
                    onClick={() => {
                      setUserDropdownOpen(false);
                      setScreen('api-key-setup');
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    <Key size={13} />
                    <span>Re-validate API Key</span>
                  </button>
                </div>

                <div className="border-t border-zinc-800/80 pt-1">
                  <button
                    onClick={handleResetAccount}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-rose-400 hover:bg-rose-950/30 transition-colors"
                  >
                    <LogOut size={13} />
                    <span>Switch Profile / Log Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            title="Settings & System Diagnostics"
          >
            <Settings size={15} />
          </button>
        </div>
      </header>

      {/* ── Main View Content ────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden">
        {activeTab === 'agents' && (
          <AgentDashboard
            onRunAgent={handleRunAgent}
            isCreateModalOpen={isCreateModalOpen}
            setIsCreateModalOpen={setIsCreateModalOpen}
          />
        )}
        {activeTab === 'console' && (
          <ChatIntake activeAgent={activeRunningAgent} />
        )}
      </main>

      {/* ── Modals & Drawers ─────────────────────────────────────── */}
      {isPreviewOpen && <PreviewModal />}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      <CreateAgentModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onAgentCreated={(newAgent) => {
          handleRunAgent(newAgent);
        }}
      />
    </div>
  );
}
