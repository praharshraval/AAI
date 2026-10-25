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
  const setActiveManifest = useStore((s) => s.setActiveManifest);
  const updateStepProgress = useStore((s) => s.updateStepProgress);
  const setPendingInputRequest = useStore((s) => s.setPendingInputRequest);
  const clearPendingInputRequest = useStore((s) => s.clearPendingInputRequest);

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
              content: event.content || event.data?.content || '',
              timestamp: new Date().toISOString(),
            });
            break;

          case 'safety_result':
            if (event.data?.classification === 'unsafe') {
              addChatMessage({
                id: crypto.randomUUID(),
                role: 'system',
                content: `Guardrail Policy Violation: ${event.data?.reason}`,
                timestamp: new Date().toISOString(),
                isGuardrailReject: true,
              });
            } else if (event.data?.reason) {
              addChatMessage({
                id: crypto.randomUUID(),
                role: 'system',
                content: `Security clearance verified: ${event.data.reason}`,
                timestamp: new Date().toISOString(),
              });
            }
            break;

          case 'rejected':
          case 'guardrail_reject':
            addChatMessage({
              id: crypto.randomUUID(),
              role: 'system',
              content:
                event.data?.reason ||
                event.reason ||
                'Request declined by security guardrails.',
              timestamp: new Date().toISOString(),
              isGuardrailReject: true,
            });
            setSidecarStatus('idle');
            break;

          case 'manifest': {
            const manifestData = event.data || event.manifest || {};
            setActiveManifest(manifestData);
            addChatMessage({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: `Generated execution plan **${manifestData.title || 'Automation Workflow'}** with ${manifestData.steps?.length || 0} coordinated operations.`,
              manifest: manifestData,
              timestamp: new Date().toISOString(),
              isManifest: true,
            });
            safe(() => invoke('get_agents')).then(({ data }) => {
              if (data) setAgents(data);
            });
            break;
          }

          case 'step_complete': {
            const stepId = event.data?.step_id;
            if (stepId) {
              updateStepProgress(stepId, {
                status: 'completed',
                result: event.data?.result,
              });
            }
            addChatMessage({
              id: crypto.randomUUID(),
              role: 'system',
              content: `Operation completed: ${event.data?.action || stepId}`,
              timestamp: new Date().toISOString(),
            });
            break;
          }

          case 'input_required': {
            setSidecarStatus('paused');
            const promptData = event.data || {};
            setPendingInputRequest(promptData);
            addChatMessage({
              id: crypto.randomUUID(),
              role: 'system',
              content: `🔒 Information Requested: ${promptData.prompt || 'Please provide required parameter to continue.'}`,
              timestamp: new Date().toISOString(),
              isPromptRequest: true,
            });
            break;
          }

          case 'hitl_pause': {
            setSidecarStatus('paused');
            const draft = event.data || event.preview || {};
            openPreview({
              type: draft.file_type || draft.type || 'text',
              content: draft.content || '',
              filename: draft.filename || 'deliverable.md',
              metadata: draft.metadata || {},
              draft_id: draft.draft_id,
              revision: draft.revision || 1,
            });
            break;
          }

          case 'draft_updated': {
            const draft = event.data || event.preview || {};
            openPreview({
              type: draft.file_type || draft.type || 'text',
              content: draft.content || '',
              filename: draft.filename || 'deliverable.md',
              metadata: draft.metadata || {},
              draft_id: draft.draft_id,
              revision: draft.revision || 1,
            });
            break;
          }

          case 'circuit_breaker': {
            const stepId = event.data?.step_id;
            if (stepId) {
              updateStepProgress(stepId, {
                status: 'tripped',
                error: event.data?.message,
              });
            }
            addChatMessage({
              id: crypto.randomUUID(),
              role: 'system',
              content: `Circuit Breaker: ${event.data?.message || 'Threshold reached'}`,
              timestamp: new Date().toISOString(),
              isError: true,
            });
            break;
          }

          case 'completed':
            clearPendingInputRequest();
            addChatMessage({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: event.data?.message || 'Workflow finished successfully.',
              timestamp: new Date().toISOString(),
            });
            setSidecarStatus('idle');
            safe(() => invoke('get_agents')).then(({ data }) => {
              if (data) setAgents(data);
            });
            break;

          case 'status': {
            const statusData = event.data || {};
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

            if (statusData.step_id) {
              updateStepProgress(statusData.step_id, {
                status: 'running',
              });
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
                event.data?.message ||
                event.message ||
                'An execution error occurred in the engine.',
              timestamp: new Date().toISOString(),
              isError: true,
            });
            setSidecarStatus('error');
            break;

          default:
            if (line.trim().startsWith('{')) {
              try {
                const parsed = JSON.parse(line);
                if (parsed.message) {
                  addChatMessage({
                    id: crypto.randomUUID(),
                    role: 'system',
                    content: parsed.message,
                    timestamp: new Date().toISOString(),
                  });
                }
              } catch {
                /* ignore non-standard json */
              }
            }
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
    [addChatMessage, setSidecarStatus, openPreview, setAgents, setActiveManifest, updateStepProgress]
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

  const getApiKey = useCallback(async () => {
    const res = await safe(() => invoke('get_api_key'));
    if (res.data) return res;
    if (typeof localStorage !== 'undefined') {
      const cached = localStorage.getItem('gemini_api_key');
      if (cached) return { data: cached, error: null };
    }
    return res;
  }, []);

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

  const hasApiKey = useCallback(async () => {
    const res = await safe(() => invoke('has_api_key'));
    if (res.data) return res;
    if (typeof localStorage !== 'undefined') {
      const cached = localStorage.getItem('gemini_api_key');
      if (cached) return { data: true, error: null };
    }
    return res;
  }, []);

  const validateGeminiKey = useCallback(
    (key) => safe(() => invoke('validate_gemini_key', { key })),
    []
  );

  const queryGemini = useCallback(
    (contents, systemInstruction, key) =>
      safe(() =>
        invoke('query_gemini', {
          key: key || null,
          contents,
          systemInstruction: systemInstruction || null,
        })
      ),
    []
  );

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

  const startSidecar = useCallback(
    async (prompt, apiKey) => {
      setSidecarStatus('running');
      const res = await safe(() =>
        invoke('start_agent_task', {
          prompt,
          apiKey: apiKey || 'local-mode',
        })
      );

      if (res.error) {
        setSidecarStatus('error');
      } else if (res.data) {
        const { data: allAgents } = await safe(() => invoke('get_agents'));
        if (allAgents) setAgents(allAgents);
      }
      return res;
    },
    [setSidecarStatus, setAgents]
  );

  const sendSidecarInput = useCallback(async (data) => {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    return safe(() => invoke('send_agent_input', { input: payload }));
  }, []);

  const stopSidecar = useCallback(async () => {
    setSidecarStatus('idle');
    return safe(() => invoke('stop_agent_task'));
  }, [setSidecarStatus]);

  const openFileInFinder = useCallback(
    (path) => safe(() => invoke('open_file_in_finder', { path })),
    []
  );

  return {
    storeApiKey,
    getApiKey,
    deleteApiKey,
    hasApiKey,
    validateGeminiKey,
    queryGemini,
    runPreflightCheck,
    autoProvision,
    getAgents,
    saveAgent,
    deleteAgent,
    getExecutionHistory,
    startSidecar,
    sendSidecarInput,
    stopSidecar,
    openFileInFinder,
  };
}
