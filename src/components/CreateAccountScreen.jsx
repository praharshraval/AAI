/**
 * CreateAccountScreen.jsx - Step 1: Initial Local Administrator Setup
 *
 * Dedicated initial onboarding page asking the user to create an account
 * before configuring API credentials and entering the dashboard.
 */

import React, { useState } from 'react';
import { Shield, ArrowRight, User, Building, Folder, Lock } from 'lucide-react';

export default function CreateAccountScreen({ onAccountCreated }) {
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');
  const [workspacePath, setWorkspacePath] = useState('~/.rpa-agent-platform/workspace/');
  const [error, setError] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide an administrator name.');
      return;
    }

    const account = {
      name: name.trim(),
      org: (org.trim() || 'Local Enterprise Workspace'),
      workspacePath: workspacePath.trim(),
      createdAt: new Date().toISOString(),
    };

    localStorage.setItem('rpa_account', JSON.stringify(account));
    onAccountCreated(account);
  };

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-[#09090b] text-zinc-100 p-6 select-none font-sans">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-[#0d0d11] p-8 shadow-2xl">
        {/* Step Indicator */}
        <div className="mb-6 flex items-center justify-between border-b border-zinc-800/80 pb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-zinc-100 font-mono text-xs font-bold text-zinc-900">
              A
            </div>
            <span className="text-xs font-bold tracking-tight text-zinc-200">
              AAI Desktop RPA
            </span>
          </div>
          <span className="font-mono text-[11px] text-zinc-500">
            Step 1 of 2 · Account Setup
          </span>
        </div>

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold tracking-tight text-zinc-100">
            Create an Account
          </h1>
          <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
            Initialize your local administrator profile. All automation definitions, credentials, and execution logs remain strictly on this device.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-900/60 bg-rose-950/30 p-2.5 text-xs text-rose-300">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Administrator Name <span className="text-rose-400">*</span>
            </label>
            <div className="relative flex items-center">
              <User size={14} className="absolute left-3 text-zinc-500" />
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. Alex Mercer"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-600 transition-colors"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Organization / Team Workspace
            </label>
            <div className="relative flex items-center">
              <Building size={14} className="absolute left-3 text-zinc-500" />
              <input
                type="text"
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                placeholder="e.g. Autonomous Operations Lab"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-600 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Sandboxed Workspace Directory
            </label>
            <div className="relative flex items-center">
              <Folder size={14} className="absolute left-3 text-zinc-500" />
              <input
                type="text"
                value={workspacePath}
                onChange={(e) => setWorkspacePath(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 pl-9 pr-3 py-2 font-mono text-xs text-zinc-400 outline-none focus:border-zinc-600 transition-colors"
              />
            </div>
            <p className="mt-1 text-[10px] text-zinc-500 font-mono">
              All browser downloads and artifacts are isolated here.
            </p>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-100 py-2.5 text-xs font-semibold text-zinc-900 hover:bg-white transition-colors"
            >
              <span>Create Account & Continue</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </form>

        {/* Security Footer */}
        <div className="mt-6 border-t border-zinc-800/80 pt-4 flex items-center justify-between text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <Shield size={13} className="text-emerald-400" />
            Local-First Hardware Isolation
          </span>
          <span className="font-mono">AES-256 Vault</span>
        </div>
      </div>
    </div>
  );
}
