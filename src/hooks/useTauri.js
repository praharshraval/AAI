/**
 * useTauri.js - Custom React hook wrapping all Tauri v2 IPC calls.
 *
 * Every function returns a normalised { data, error } envelope so callers
 * never need to catch exceptions themselves. Sidecar lifecycle helpers
 * push events directly into the zustand store and SQLite database.
 */

import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import useStore from './useStore';

/**
 * Wrap an async operation so it always resolves to { data, error }.
 * @param {Function} fn - Async thunk returning a value.
 * @returns {Promise<{ data: any, error: string|null }>}
 */
async function safe(fn) {
  try {
    const data = await fn();
    return { data, error: null };
  } catch (err) {
    console.error('[useTauri]', err);
    return { data: null, error: err?.message ?? String(err) };
  }
}

export default function useTauri() {
  const unlistenRef = useRef(null);

  // ─── Store selectors ──────────────────────────────────────────────
  const addChatMessage = useStore((s) => s.addChatMessage);
  const setSidecarStatus = useStore((s) => s.setSidecarStatus);
  const openPreview = useStore((s) => s.openPreview);
  const setAgents = useStore((s) => s.setAgents);

  // ─── Process incoming events from the Python engine ───────────────
  const processAgentEventLine = useCallback(
    (line) => {
      if (!line || !line.trim()) return;

      try {
        const event = JSON.parse(line);

        switch (event.type) {
          case 'message':
            addChatMessage({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: event.content ?? event.data?.content ?? '',
              timestamp: new Date().toISOString(),
            });
            break;

          case 'safety_result':
            if (event.data?.classification === 'unsafe') {
              addChatMessage({
                id: crypto.randomUUID(),
                role: 'system',
                content: `🛡️ Ethical Guardrail Notice: ${event.data?.reason}`,
                timestamp: new Date().toISOString(),
                isGuardrailReject: true,
              });
            }
            break;

          case 'rejected':
          case 'guardrail_reject':
            addChatMessage({
              id: crypto.randomUUID(),
              role: 'system',
              content:
                event.data?.reason ??
                event.reason ??
                'Prompt rejected by ethical guardrails.',
              timestamp: new Date().toISOString(),
              isGuardrailReject: true,
            });
            setSidecarStatus('idle');
            break;

          case 'manifest':
            addChatMessage({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: JSON.stringify(event.data ?? event.manifest, null, 2),
              timestamp: new Date().toISOString(),
              isManifest: true,
            });
            // Refresh agents list in store
            safe(() => invoke('get_agents')).then(({ data }) => {
              if (data) setAgents(data);
            });
            break;

          case 'hitl_pause': {
            setSidecarStatus('paused');
            const draft = event.data ?? event.preview ?? {};
            openPreview({
              type: draft.file_type ?? draft.type ?? 'text',
              content: draft.content ?? '',
              filename: draft.filename ?? 'draft.txt',
              metadata: draft.metadata ?? {},
              draft_id: draft.draft_id,
              revision: draft.revision ?? 1,
            });
            break;
          }

          case 'draft_updated': {
            const draft = event.data ?? event.preview ?? {};
            openPreview({
              type: draft.file_type ?? draft.type ?? 'text',
              content: draft.content ?? '',
              filename: draft.filename ?? 'draft.txt',
              metadata: draft.metadata ?? {},
              draft_id: draft.draft_id,
              revision: draft.revision ?? 1,
            });
            break;
          }

          case 'step_complete':
            addChatMessage({
              id: crypto.randomUUID(),
              role: 'system',
              content: `Step completed: ${event.data?.step_id ?? ''}`,
              timestamp: new Date().toISOString(),
            });
            break;

          case 'circuit_breaker':
            addChatMessage({
              id: crypto.randomUUID(),
              role: 'system',
              content: `⚡ Circuit Breaker: ${
                event.data?.message ?? 'Trip threshold reached'
              }`,
              timestamp: new Date().toISOString(),
              isError: true,
            });
            break;

          case 'completed':
            addChatMessage({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: event.data?.message ?? 'Task completed successfully.',
              timestamp: new Date().toISOString(),
            });
            setSidecarStatus('idle');
            safe(() => invoke('get_agents')).then(({ data }) => {
              if (data) setAgents(data);
            });
            break;

          case 'status': {
            const statusData = event.data ?? {};
            if (statusData.step === 'paused') {
              setSidecarStatus('paused');
            } else if (
              statusData.step === 'completed' ||
              statusData.step === 'cancelled'
            ) {
              setSidecarStatus('idle');
            } else {
              setSidecarStatus('running');
            }
            if (statusData.message) {
              addChatMessage({
                id: crypto.randomUUID(),
                role: 'system',
                content: statusData.message,
                timestamp: new Date().toISOString(),
              });
            }
            break;
          }

          case 'stderr':
            console.warn('[sidecar:stderr]', event.data?.message);
            break;

          case 'error':
            addChatMessage({
              id: crypto.randomUUID(),
              role: 'system',
              content:
                event.data?.message ??
                event.message ??
                'An error occurred in the sidecar.',
              timestamp: new Date().toISOString(),
              isError: true,
            });
            setSidecarStatus('error');
            break;

          default:
            addChatMessage({
              id: crypto.randomUUID(),
              role: 'system',
              content: line,
              timestamp: new Date().toISOString(),
            });
        }
      } catch {
        addChatMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: line,
          timestamp: new Date().toISOString(),
        });
      }
    },
    [addChatMessage, setSidecarStatus, openPreview, setAgents]
  );

  // Listen to Tauri events emitted from Rust background tasks
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const unlisten = await listen('agent-event', (event) => {
          if (isMounted && event.payload) {
            processAgentEventLine(event.payload);
          }
        });
        unlistenRef.current = unlisten;
      } catch (err) {
        console.warn('[useTauri] Event listen notice:', err);
      }
    })();

    return () => {
      isMounted = false;
      if (unlistenRef.current) {
        unlistenRef.current();
      }
    };
  }, [processAgentEventLine]);

  // ─── API Key Management ────────────────────────────────────────────

  /** Persist an API key in the OS secure store + local vault. */
  const storeApiKey = useCallback(async (key) => {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('gemini_api_key', key);
      } catch {
        /* ignore */
      }
    }
    return safe(() => invoke('store_api_key', { key }));
  }, []);

  /** Retrieve the stored API key. */
  const getApiKey = useCallback(async () => {
    const res = await safe(() => invoke('get_api_key'));
    if (res.data) return res;
    if (typeof localStorage !== 'undefined') {
      const cached = localStorage.getItem('gemini_api_key');
      if (cached) return { data: cached, error: null };
    }
    return res;
  }, []);

  /** Delete the stored API key. */
  const deleteApiKey = useCallback(async () => {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('gemini_api_key');
      } catch {
        /* ignore */
      }
    }
    return safe(() => invoke('delete_api_key'));
  }, []);

  /** Check whether an API key is stored. */
  const hasApiKey = useCallback(async () => {
    const res = await safe(() => invoke('has_api_key'));
    if (res.data) return res;
    if (typeof localStorage !== 'undefined') {
      const cached = localStorage.getItem('gemini_api_key');
      if (cached) return { data: true, error: null };
    }
    return res;
  }, []);

  // ─── Preflight & Provisioning ──────────────────────────────────────

  const runPreflightCheck = useCallback(
    () => safe(() => invoke('run_preflight_check')),
    []
  );

  const autoProvision = useCallback(
    (component) => safe(() => invoke('auto_provision', { component })),
    []
  );

  // ─── Agent CRUD ────────────────────────────────────────────────────

  const getAgents = useCallback(() => safe(() => invoke('get_agents')), []);

  const saveAgent = useCallback(
    (agent) => safe(() => invoke('save_agent', { agent })),
    []
  );

  const deleteAgent = useCallback(
    (id) => safe(() => invoke('delete_agent', { id })),
    []
  );

  const getExecutionHistory = useCallback(
    (agentId) => safe(() => invoke('get_execution_history', { agentId })),
    []
  );

  // ─── Sidecar Lifecycle via Rust Engine ─────────────────────────────

  /**
   * Launch the Python engine sidecar and create the agent in SQLite.
   *
   * @param {string} prompt - The user's automation prompt.
   * @param {string} apiKey - Optional Gemini API key override.
   * @returns {{ data: AgentRecord, error: string|null }}
   */
  const startSidecar = useCallback(
    async (prompt, apiKey) => {
      setSidecarStatus('running');
      const res = await safe(() =>
        invoke('start_agent_task', {
          prompt,
          apiKey: apiKey ?? null,
        })
      );

      if (res.error) {
        setSidecarStatus('error');
      } else if (res.data) {
        // Refresh agents in dashboard store immediately
        const { data: allAgents } = await safe(() => invoke('get_agents'));
        if (allAgents) setAgents(allAgents);
      }
      return res;
    },
    [setSidecarStatus, setAgents]
  );

  /**
   * Write a JSON payload to the sidecar's stdin.
   * @param {Object} data - Arbitrary data to send.
   */
  const sendSidecarInput = useCallback(async (data) => {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    return safe(() => invoke('send_agent_input', { input: payload }));
  }, []);

  /**
   * Stop or cancel the currently running agent.
   */
  const stopSidecar = useCallback(async () => {
    setSidecarStatus('idle');
    return safe(() => invoke('stop_agent_task'));
  }, [setSidecarStatus]);

  // ─── Public API ────────────────────────────────────────────────────

  return {
    // API key
    storeApiKey,
    getApiKey,
    deleteApiKey,
    hasApiKey,

    // Preflight
    runPreflightCheck,
    autoProvision,

    // Agents
    getAgents,
    saveAgent,
    deleteAgent,
    getExecutionHistory,

    // Sidecar
    startSidecar,
    sendSidecarInput,
    stopSidecar,
  };
}
