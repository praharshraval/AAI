/**
 * CreateAgentModal.jsx - Prompt Requirement Analyzer & Agent Generator
 *
 * Takes a natural language automation prompt, analyzes requirements via Gemini
 * or local specification engine, compiles a LangGraph manifest, and persists
 * the newly created agent to SQLite.
 */

import React, { useState } from 'react';
import { X, Sparkles, Loader2, ArrowRight, Bot, Shield, Globe, HardDrive } from 'lucide-react';
import { analyzeRequirement } from '../utils/requirementAnalyzer';
import useTauri from '../hooks/useTauri';
import useStore from '../hooks/useStore';

export default function CreateAgentModal({ isOpen, onClose, onAgentCreated }) {
  const { saveAgent, getApiKey, getAgents } = useTauri();
  const setAgents = useStore((s) => s.setAgents);

  const [prompt, setPrompt] = useState('');
  const [nameOverride, setNameOverride] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState('');
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleBuildAgent = async (e) => {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) {
      setError('Please provide a prompt describing what this agent should automate.');
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setAnalysisStep('Evaluating requirements & safety guardrails...');

    try {
      const { data: apiKey } = await getApiKey();

      setAnalysisStep('Analyzing domain requirements with Gemini...');
      const spec = await analyzeRequirement(trimmed, apiKey);

      setAnalysisStep('Compiling LangGraph execution manifest...');

      const agentName = nameOverride.trim() || spec.name || 'Autonomous RPA Agent';
      const now = new Date().toISOString();

      const newAgent = {
        id: crypto.randomUUID(),
        name: agentName,
        description: spec.description || `Autonomous agent configured for: ${trimmed}`,
        prompt: trimmed,
        manifest_json: JSON.stringify(spec.manifest || {}),
        status: 'idle',
        created_at: now,
        updated_at: now,
      };

      setAnalysisStep('Saving agent definition to SQLite database...');
      const res = await saveAgent(newAgent);

      if (res.error) {
        throw new Error(res.error);
      }

      // Refresh agents list in Zustand store
      const { data: allAgents } = await getAgents();
      if (allAgents) setAgents(allAgents);

      setIsAnalyzing(false);
      onClose();
      onAgentCreated(newAgent);
    } catch (err) {
      console.error('[CreateAgentModal] Build error:', err);
      setError(`Failed to create agent: ${err.message}`);
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm select-none">
      <div className="w-full max-w-xl rounded-xl border border-zinc-800 bg-[#0d0d11] p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-800/80 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-zinc-800 text-zinc-200">
              <Bot size={16} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Create New Autonomous Agent</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Analyze requirement prompt and compile multi-agent execution pipeline
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isAnalyzing}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-900/60 bg-rose-950/30 p-3 text-xs text-rose-300">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleBuildAgent} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Automation Requirement Directive <span className="text-rose-400">*</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setError(null);
              }}
              rows={4}
              placeholder="Describe the agent's objective. Example: 'Build an agent that scrapes technology news headlines from Hacker News, extracts the top stories into JSON, writes them to the workspace sandbox, and prepares an executive briefing report for review.'"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-200 placeholder-zinc-700 outline-none focus:border-zinc-600 transition-colors leading-relaxed"
              autoFocus
              disabled={isAnalyzing}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Custom Agent Name <span className="text-zinc-600 font-normal">(optional - auto-inferred if blank)</span>
            </label>
            <input
              type="text"
              value={nameOverride}
              onChange={(e) => setNameOverride(e.target.value)}
              placeholder="e.g. Hacker News Intelligence Agent"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs text-zinc-200 placeholder-zinc-700 outline-none focus:border-zinc-600 transition-colors"
              disabled={isAnalyzing}
            />
          </div>

          {/* Analysis Progress */}
          {isAnalyzing && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300 flex items-center gap-2.5">
              <Loader2 size={14} className="animate-spin text-zinc-400 shrink-0" />
              <span className="font-mono text-[11px] text-zinc-300">{analysisStep}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isAnalyzing}
              className="rounded-lg border border-zinc-800 px-3.5 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={!prompt.trim() || isAnalyzing}
              className="flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-900 hover:bg-white transition-colors disabled:opacity-40"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Analyzing & Generating...</span>
                </>
              ) : (
                <>
                  <span>Analyze & Create Agent</span>
                  <ArrowRight size={13} />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
