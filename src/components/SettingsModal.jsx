/**
 * SettingsModal.jsx - Settings modal for API key configuration,
 * system health / preflight checks, and app information.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  Key,
  Eye,
  EyeOff,
  Shield,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Download,
  X,
  Info,
} from 'lucide-react';
import useStore from '../hooks/useStore';
import useTauri from '../hooks/useTauri';

// ─── Tab definitions ───────────────────────────────────────────────────

const TABS = [
  { id: 'api', label: 'API Config', icon: Key },
  { id: 'health', label: 'System Health', icon: Shield },
  { id: 'about', label: 'About', icon: Info },
];

// ─── Check-item sub-component ──────────────────────────────────────────

function CheckItem({ label, ok, detail, onProvision, isProvisioning }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-gray-800/50 px-4 py-3">
      <div className="flex items-center gap-3">
        {ok ? (
          <CheckCircle2 size={16} className="text-green-400 shrink-0" />
        ) : (
          <XCircle size={16} className="text-red-400 shrink-0" />
        )}
        <div>
          <p className="text-sm text-gray-200">{label}</p>
          {detail && (
            <p className="text-[11px] text-gray-500">{detail}</p>
          )}
        </div>
      </div>
      {!ok && onProvision && (
        <button
          onClick={onProvision}
          disabled={isProvisioning}
          className="flex items-center gap-1 rounded-lg bg-indigo-600/20 px-3 py-1.5 text-[11px] font-medium text-indigo-300 transition-colors hover:bg-indigo-600/40 disabled:opacity-40"
        >
          {isProvisioning ? (
            <RefreshCw size={11} className="animate-spin" />
          ) : (
            <Download size={11} />
          )}
          Provision
        </button>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────

export default function SettingsModal({ isOpen, onClose }) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const {
    storeApiKey,
    deleteApiKey,
    hasApiKey,
    runPreflightCheck,
    autoProvision,
  } = useTauri();

  const [activeTab, setActiveTab] = useState('api');
  const [keyValue, setKeyValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keySaving, setKeySaving] = useState(false);
  const [keyDeleting, setKeyDeleting] = useState(false);
  const [testResult, setTestResult] = useState(null); // 'ok' | 'fail' | null
  const [statusMessage, setStatusMessage] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const [preflightRunning, setPreflightRunning] = useState(false);
  const [provisioningComponent, setProvisioningComponent] = useState(null);

  // Check API key status on open.
  useEffect(() => {
    if (!isOpen) return;
    setStatusMessage(null);
    setErrorMessage(null);
    (async () => {
      const { data: hasKey } = await hasApiKey();
      updateSettings({ apiKeyConfigured: !!hasKey });
      if (hasKey) {
        const { data: keyVal } = await getApiKey();
        if (keyVal && !keyValue) {
          setKeyValue(keyVal);
        }
      }
    })();
  }, [isOpen, hasApiKey, getApiKey, updateSettings]);

  // ── API Key handlers ────────────────────────────────────────────

  const handleSaveKey = useCallback(async () => {
    if (!keyValue.trim()) return;
    setKeySaving(true);
    setStatusMessage(null);
    setErrorMessage(null);
    const { error } = await storeApiKey(keyValue.trim());
    if (!error) {
      updateSettings({ apiKeyConfigured: true });
      setStatusMessage('✓ API key stored securely in OS Keyring & local AES-256 vault');
      setTestResult(null);
    } else {
      setErrorMessage(`Failed to save key: ${error}`);
    }
    setKeySaving(false);
  }, [keyValue, storeApiKey, updateSettings]);

  const handleDeleteKey = useCallback(async () => {
    setKeyDeleting(true);
    setStatusMessage(null);
    setErrorMessage(null);
    await deleteApiKey();
    updateSettings({ apiKeyConfigured: false });
    setKeyValue('');
    setStatusMessage('API key deleted from keyring & vault.');
    setKeyDeleting(false);
    setTestResult(null);
  }, [deleteApiKey, updateSettings]);

  const handleTestConnection = useCallback(() => {
    setStatusMessage(null);
    setErrorMessage(null);
    setTestResult(keyValue.trim().length > 0 ? 'ok' : 'fail');
  }, [keyValue]);

  // ── Preflight handlers ──────────────────────────────────────────

  const handleRunPreflight = useCallback(async () => {
    setPreflightRunning(true);
    const { data } = await runPreflightCheck();
    updateSettings({ preflightStatus: data ?? null });
    setPreflightRunning(false);
  }, [runPreflightCheck, updateSettings]);

  const handleProvision = useCallback(
    async (component) => {
      setProvisioningComponent(component);
      await autoProvision(component);
      // Re-run preflight to refresh status.
      await handleRunPreflight();
      setProvisioningComponent(null);
    },
    [autoProvision, handleRunPreflight]
  );

  if (!isOpen) return null;

  const pf = settings.preflightStatus;

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-gray-700/50 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Settings size={18} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-100">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-800 px-6">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`mr-1 flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
                activeTab === id
                  ? 'border-indigo-500 text-indigo-300'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
          {/* ───────── API Configuration ───────── */}
          {activeTab === 'api' && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-400">
                  Gemini API Key
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={keyValue}
                    onChange={(e) => {
                      setKeyValue(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder="Enter your API key…"
                    className="w-full rounded-xl border border-gray-700 bg-gray-800/70 px-4 py-2.5 pr-10 text-sm text-gray-200 placeholder-gray-500 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  >
                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Status */}
              <div className="flex items-center gap-2 text-xs">
                {settings.apiKeyConfigured ? (
                  <>
                    <CheckCircle2 size={14} className="text-green-400" />
                    <span className="text-green-300">API key configured</span>
                  </>
                ) : (
                  <>
                    <XCircle size={14} className="text-red-400" />
                    <span className="text-red-300">No API key configured</span>
                  </>
                )}
              </div>

              {/* Test result */}
              {testResult && (
                <div
                  className={`rounded-lg px-3 py-2 text-xs ${
                    testResult === 'ok'
                      ? 'bg-green-900/30 text-green-300 border border-green-700/40'
                      : 'bg-red-900/30 text-red-300 border border-red-700/40'
                  }`}
                >
                  {testResult === 'ok'
                    ? 'Connection test passed ✓'
                    : 'Connection test failed – key appears empty.'}
                </div>
              )}

              {/* Status or Error Banner */}
              {statusMessage && (
                <div className="rounded-lg bg-green-900/40 border border-green-600/50 px-3 py-2 text-xs text-green-300">
                  {statusMessage}
                </div>
              )}
              {errorMessage && (
                <div className="rounded-lg bg-red-900/40 border border-red-600/50 px-3 py-2 text-xs text-red-300">
                  {errorMessage}
                </div>
              )}

              {/* Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveKey}
                  disabled={!keyValue.trim() || keySaving}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {keySaving && (
                    <RefreshCw size={12} className="animate-spin" />
                  )}
                  Save
                </button>
                <button
                  onClick={handleTestConnection}
                  className="rounded-lg border border-gray-700 px-4 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800"
                >
                  Test Connection
                </button>
                <button
                  onClick={handleDeleteKey}
                  disabled={!settings.apiKeyConfigured || keyDeleting}
                  className="ml-auto rounded-lg px-3 py-2 text-xs text-red-400 transition-colors hover:bg-red-900/20 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {keyDeleting ? 'Deleting…' : 'Delete Key'}
                </button>
              </div>
            </div>
          )}

          {/* ───────── System Health ───────── */}
          {activeTab === 'health' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Pre-flight Check
                </p>
                <button
                  onClick={handleRunPreflight}
                  disabled={preflightRunning}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600/20 px-3 py-1.5 text-[11px] font-medium text-indigo-300 transition-colors hover:bg-indigo-600/40 disabled:opacity-40"
                >
                  <RefreshCw
                    size={11}
                    className={preflightRunning ? 'animate-spin' : ''}
                  />
                  Run Check
                </button>
              </div>

              {!pf ? (
                <p className="py-8 text-center text-sm text-gray-500">
                  No preflight results yet. Click &quot;Run Check&quot; above.
                </p>
              ) : (
                <>
                  <CheckItem
                    label="OS & Architecture"
                    ok={pf.os?.ok ?? false}
                    detail={pf.os?.detail}
                  />
                  <CheckItem
                    label="Python Runtime"
                    ok={pf.python?.ok ?? false}
                    detail={
                      pf.python?.version
                        ? `Version ${pf.python.version}`
                        : pf.python?.detail
                    }
                    onProvision={() => handleProvision('python')}
                    isProvisioning={provisioningComponent === 'python'}
                  />
                  <CheckItem
                    label="Pip Available"
                    ok={pf.pip?.ok ?? false}
                    detail={pf.pip?.detail}
                    onProvision={() => handleProvision('pip')}
                    isProvisioning={provisioningComponent === 'pip'}
                  />
                  <CheckItem
                    label="Playwright Browsers"
                    ok={pf.playwright?.ok ?? false}
                    detail={pf.playwright?.detail}
                    onProvision={() => handleProvision('playwright')}
                    isProvisioning={provisioningComponent === 'playwright'}
                  />
                  <CheckItem
                    label="Virtual Environment"
                    ok={pf.venv?.ok ?? false}
                    detail={pf.venv?.detail}
                    onProvision={() => handleProvision('venv')}
                    isProvisioning={provisioningComponent === 'venv'}
                  />
                </>
              )}
            </div>
          )}

          {/* ───────── About ───────── */}
          {activeTab === 'about' && (
            <div className="space-y-4 text-sm text-gray-400">
              <div className="rounded-xl bg-gray-800/50 p-4">
                <h3 className="text-xs font-semibold text-gray-200 uppercase tracking-wider mb-3">
                  Application
                </h3>
                <dl className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Version</dt>
                    <dd className="font-mono text-gray-300">1.0.0-alpha</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Framework</dt>
                    <dd className="font-mono text-gray-300">Tauri v2 + React 18</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Engine</dt>
                    <dd className="font-mono text-gray-300">
                      Python Sidecar (Playwright)
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-xl bg-gray-800/50 p-4">
                <h3 className="text-xs font-semibold text-gray-200 uppercase tracking-wider mb-3">
                  System
                </h3>
                <dl className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Platform</dt>
                    <dd className="font-mono text-gray-300">
                      {typeof navigator !== 'undefined'
                        ? navigator.platform
                        : 'Unknown'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">User Agent</dt>
                    <dd className="font-mono text-gray-300 text-right max-w-[250px] truncate">
                      {typeof navigator !== 'undefined'
                        ? navigator.userAgent.split(' ').slice(0, 3).join(' ')
                        : 'Unknown'}
                    </dd>
                  </div>
                </dl>
              </div>

              <p className="text-center text-[11px] text-gray-600">
                Built with ♥ using Tauri, React, and Gemini AI.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
