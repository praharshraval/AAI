/**
 * ApiKeySetupScreen.jsx - Step 2: Gemini API Key Intake & Live Validation
 *
 * Dedicated setup screen requiring the user to paste their Gemini API key,
 * validating it live against Google's API before navigating to the dashboard.
 */

import React, { useState } from 'react';
import { Key, Eye, EyeOff, CheckCircle2, AlertCircle, ArrowRight, Loader2, ExternalLink } from 'lucide-react';
import useTauri from '../hooks/useTauri';
import useStore from '../hooks/useStore';

export default function ApiKeySetupScreen({ onKeyValidated }) {
  const { storeApiKey, validateGeminiKey } = useTauri();
  const updateSettings = useStore((s) => s.updateSettings);

  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationSuccess, setValidationSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const handleValidateAndProceed = async (e) => {
    e.preventDefault();
    const trimmed = apiKey.trim();

    if (!trimmed) {
      setErrorMessage('Please paste your Google Gemini API key to validate.');
      return;
    }

    setIsValidating(true);
    setErrorMessage(null);
    setValidationSuccess(false);

    try {
      // 1. First try native Rust backend validator (bypasses all webview CSP restrictions)
      const { data, error } = await validateGeminiKey(trimmed);

      if (data) {
        await storeApiKey(trimmed);
        updateSettings({ apiKeyConfigured: true });
        setValidationSuccess(true);
        setTimeout(() => {
          onKeyValidated(trimmed);
        }, 750);
        return;
      }

      if (error) {
        setErrorMessage(error);
      }
    } catch (err) {
      setErrorMessage(`Validation error: ${err.message}`);
    } finally {
      setIsValidating(false);
    }
  };

  const handleSkipToLocal = async () => {
    await storeApiKey('local-mode');
    updateSettings({ apiKeyConfigured: false });
    onKeyValidated('local-mode');
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
            Step 2 of 2 · API Configuration
          </span>
        </div>

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold tracking-tight text-zinc-100">
            Connect Gemini API Key
          </h1>
          <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
            Paste your Google Gemini API key to activate Gemini 2.0 Flash reasoning, multimodal vision fallback, and autonomous planning.
          </p>
        </div>

        {/* Status / Errors */}
        {validationSuccess && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-3 text-xs text-emerald-300">
            <CheckCircle2 size={16} className="shrink-0" />
            <span>✓ API Key Validated! Connecting to Dashboard...</span>
          </div>
        )}

        {errorMessage && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-900/60 bg-rose-950/30 p-3 text-xs text-rose-300">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed">{errorMessage}</div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleValidateAndProceed} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-zinc-300">
                Gemini API Key <span className="text-rose-400">*</span>
              </label>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <span>Get a free key</span>
                <ExternalLink size={10} />
              </a>
            </div>

            <div className="relative flex items-center">
              <Key size={14} className="absolute left-3 text-zinc-500" />
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setErrorMessage(null);
                }}
                placeholder="AIzaSy..."
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 pl-9 pr-10 py-2.5 font-mono text-xs text-zinc-100 placeholder-zinc-700 outline-none focus:border-zinc-600 transition-colors"
                autoFocus
                disabled={isValidating || validationSuccess}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 text-zinc-500 hover:text-zinc-300"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-zinc-500 font-mono">
              Stored in macOS Keychain & encrypted local AES-256-GCM vault.
            </p>
          </div>

          <div className="pt-2 space-y-2">
            <button
              type="submit"
              disabled={isValidating || validationSuccess}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-100 py-2.5 text-xs font-semibold text-zinc-900 hover:bg-white transition-colors disabled:opacity-50"
            >
              {isValidating ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Validating Key against Gemini API...</span>
                </>
              ) : (
                <>
                  <span>Validate API Key & Enter Dashboard</span>
                  <ArrowRight size={14} />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleSkipToLocal}
              disabled={isValidating || validationSuccess}
              className="w-full text-center py-2 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Skip for now · Continue with Local Autonomous Engine
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
