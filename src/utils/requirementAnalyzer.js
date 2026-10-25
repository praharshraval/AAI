/**
 * requirementAnalyzer.js
 *
 * Analyzes natural-language requirements using Google Gemini 2.0 Flash (if API key available)
 * or built-in autonomous heuristic decomposition to construct Agent definitions and manifests.
 */

export async function analyzeRequirement(userPrompt, apiKey) {
  const prompt = userPrompt.trim();
  const isCloudKey = Boolean(
    apiKey &&
    !apiKey.startsWith('local') &&
    !apiKey.startsWith('test') &&
    apiKey.length > 15
  );

  if (isCloudKey) {
    try {
      const systemInstruction = `You are an Enterprise RPA Architect. Analyze the user's automation directive and construct an autonomous agent specification.
Output ONLY a valid JSON object (no markdown fencing) with this schema:
{
  "name": "<concise agent name (3 to 6 words)>",
  "description": "<detailed 1-2 sentence description of what the agent accomplishes>",
  "category": "Browser RPA" | "Data Pipeline" | "System Automation" | "Research & Intelligence",
  "tools": ["browser", "filesystem", "gemini"],
  "manifest": {
    "title": "<agent name>",
    "description": "<description>",
    "steps": [
      {
        "action": "<action description>",
        "tool": "browser" | "filesystem" | "gemini",
        "parameters": {}
      }
    ]
  }
}`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { text: `${systemInstruction}\n\nUser Directive:\n${prompt}` }
                ]
              }
            ],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json'
            }
          })
        }
      );

      if (res.ok) {
        const json = await res.json();
        const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          const parsed = JSON.parse(rawText.trim());
          if (parsed.name && parsed.manifest) {
            // Ensure step_ids
            parsed.manifest.steps = (parsed.manifest.steps || []).map((s) => ({
              ...s,
              step_id: crypto.randomUUID(),
              status: 'pending',
              retry_count: 0,
              max_retries: 3,
            }));
            return parsed;
          }
        }
      }
    } catch (e) {
      console.warn('[requirementAnalyzer] Cloud analysis notice:', e);
    }
  }

  // Heuristic Autonomous Decomposition Fallback
  return generateAutonomousSpecification(prompt);
}

function generateAutonomousSpecification(prompt) {
  const p = prompt.toLowerCase();
  const isWeb = /scrape|web|url|site|browser|crawl|monitor|news|price|html/.test(p);
  const isData = /csv|excel|table|report|file|directory|folder|audit|expense|calc/.test(p);

  if (isWeb) {
    const name = extractAgentName(prompt, 'Web Intelligence & Extraction Agent');
    return {
      name,
      description: `Automated headless browser navigation, DOM node extraction, and structured synthesis for: ${prompt}`,
      category: 'Browser RPA',
      tools: ['browser', 'gemini', 'filesystem'],
      manifest: {
        title: name,
        description: `Automates web data gathering, DOM parsing, and reporting for: ${prompt}`,
        steps: [
          {
            step_id: crypto.randomUUID(),
            action: 'Initialize headless Playwright session and navigate to target URL',
            tool: 'browser',
            parameters: { action: 'navigate', url: 'https://news.ycombinator.com' },
          },
          {
            step_id: crypto.randomUUID(),
            action: 'Extract DOM content nodes and capture snapshot',
            tool: 'browser',
            parameters: { action: 'get_content' },
          },
          {
            step_id: crypto.randomUUID(),
            action: 'Parse and structure extracted data into JSON format',
            tool: 'gemini',
            parameters: { prompt: `Structure key metrics from web data for: ${prompt}` },
          },
          {
            step_id: crypto.randomUUID(),
            action: 'Persist dataset artifact to workspace sandbox',
            tool: 'filesystem',
            parameters: { action: 'write', path: 'extracted_dataset.json', overwrite: true },
          },
          {
            step_id: crypto.randomUUID(),
            action: 'Synthesize executive review report',
            tool: 'gemini',
            parameters: { prompt: `Prepare final executive report for: ${prompt}` },
          },
        ],
      },
    };
  }

  if (isData) {
    const name = extractAgentName(prompt, 'Data Processing & Audit Pipeline');
    return {
      name,
      description: `Sandboxed workspace file inspection, tabular record normalization, and CSV export for: ${prompt}`,
      category: 'Data Pipeline',
      tools: ['filesystem', 'gemini'],
      manifest: {
        title: name,
        description: `Automates file inspection, record normalization, and CSV reporting for: ${prompt}`,
        steps: [
          {
            step_id: crypto.randomUUID(),
            action: 'Scan workspace directory for existing input records and schemas',
            tool: 'filesystem',
            parameters: { action: 'list', path: '.' },
          },
          {
            step_id: crypto.randomUUID(),
            action: 'Process records and build normalized tabular dataset',
            tool: 'gemini',
            parameters: { prompt: `Generate structured tabular records for: ${prompt}` },
          },
          {
            step_id: crypto.randomUUID(),
            action: 'Export processed data table to CSV in workspace sandbox',
            tool: 'filesystem',
            parameters: { action: 'write', path: 'processed_audit_report.csv', overwrite: true },
          },
          {
            step_id: crypto.randomUUID(),
            action: 'Draft comprehensive audit summary and variance report',
            tool: 'gemini',
            parameters: { prompt: `Draft executive audit deliverable for: ${prompt}` },
          },
        ],
      },
    };
  }

  const name = extractAgentName(prompt, 'Autonomous Process Agent');
  return {
    name,
    description: `Autonomous multi-step execution, validation, and deliverable synthesis for: ${prompt}`,
    category: 'System Automation',
    tools: ['filesystem', 'gemini'],
    manifest: {
      title: name,
      description: `Automates task requirements and produces deliverables for: ${prompt}`,
      steps: [
        {
          step_id: crypto.randomUUID(),
          action: 'Validate workspace environment and initialize runtime sandbox',
          tool: 'filesystem',
          parameters: { action: 'list', path: '.' },
        },
        {
          step_id: crypto.randomUUID(),
          action: 'Execute operational logic and compute task deliverables',
          tool: 'gemini',
          parameters: { prompt: `Execute core requirements for: ${prompt}` },
        },
        {
          step_id: crypto.randomUUID(),
          action: 'Persist operational artifacts to workspace storage',
          tool: 'filesystem',
          parameters: { action: 'write', path: 'task_output.json', overwrite: true },
        },
        {
          step_id: crypto.randomUUID(),
          action: 'Synthesize final deliverable for Human-In-The-Loop review',
          tool: 'gemini',
          parameters: { prompt: `Prepare final review draft for: ${prompt}` },
        },
      ],
    },
  };
}

function extractAgentName(prompt, fallback) {
  const words = prompt
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w) => !['build', 'create', 'an', 'agent', 'that', 'to', 'for', 'the', 'and', 'a'].includes(w.toLowerCase()));

  if (words.length >= 2) {
    return words.slice(0, 4).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') + ' Agent';
  }
  return fallback;
}
