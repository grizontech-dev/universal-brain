'use client';

import { useState, useCallback } from 'react';

const BRAIN_API = process.env.NEXT_PUBLIC_BRAIN_API_URL || 'http://localhost:8001';

export default function DebugMemoryPage() {
  const [sessionId, setSessionId] = useState('');
  const [entries, setEntries] = useState<any[]>([]);
  const [sessionData, setSessionData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionField, setSessionField] = useState('');
  const [sessionValue, setSessionValue] = useState('');
  const [wfState, setWfState] = useState('building');
  const [wfAgent, setWfAgent] = useState('BuilderAgent');
  const [writeMsg, setWriteMsg] = useState('');

  const [ownerId, setOwnerId] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  const [projectDetail, setProjectDetail] = useState<any>(null);
  const [projectIdInput, setProjectIdInput] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newProjectOwner, setNewProjectOwner] = useState('');
  const [requirementText, setRequirementText] = useState('');
  const [stackFrontend, setStackFrontend] = useState('');
  const [stackBackend, setStackBackend] = useState('');
  const [projectLoading, setProjectLoading] = useState(false);

  const listProjects = useCallback(async () => {
    if (!ownerId.trim()) return;
    setProjectLoading(true);
    setError('');
    setWriteMsg('');
    try {
      const res = await fetch(`${BRAIN_API}/brain/projects?owner_id=${encodeURIComponent(ownerId.trim())}`);
      if (!res.ok) throw new Error(`List projects failed: ${res.status}`);
      const data = await res.json();
      setProjects(Array.isArray(data) ? data : data.projects || []);
      setWriteMsg(`Found ${Array.isArray(data) ? data.length : (data.projects || []).length} projects`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProjectLoading(false);
    }
  }, [ownerId]);

  const getProject = useCallback(async () => {
    if (!projectIdInput.trim()) return;
    setProjectLoading(true);
    setError('');
    setWriteMsg('');
    try {
      const res = await fetch(`${BRAIN_API}/brain/projects/${projectIdInput.trim()}`);
      if (!res.ok) throw new Error(`Get project failed: ${res.status}`);
      const data = await res.json();
      setProjectDetail(data);
      setWriteMsg('Project loaded');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProjectLoading(false);
    }
  }, [projectIdInput]);

  const createProject = useCallback(async () => {
    if (!newProjectName.trim() || !newProjectOwner.trim()) return;
    setProjectLoading(true);
    setError('');
    setWriteMsg('');
    try {
      const res = await fetch(`${BRAIN_API}/brain/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProjectName.trim(),
          description: newProjectDesc.trim(),
          owner_id: newProjectOwner.trim(),
        }),
      });
      if (!res.ok) throw new Error(`Create project failed: ${res.status}`);
      const data = await res.json();
      setProjectDetail(data);
      setProjectIdInput(data.id || '');
      setWriteMsg(`Project created: ${data.id}`);
      if (ownerId.trim()) listProjects();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProjectLoading(false);
    }
  }, [newProjectName, newProjectDesc, newProjectOwner, ownerId, listProjects]);

  const appendRequirement = useCallback(async () => {
    if (!projectIdInput.trim() || !requirementText.trim()) return;
    setProjectLoading(true);
    setError('');
    setWriteMsg('');
    try {
      const res = await fetch(`${BRAIN_API}/brain/projects/${projectIdInput.trim()}/requirements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement: requirementText.trim() }),
      });
      if (!res.ok) throw new Error(`Append requirement failed: ${res.status}`);
      setWriteMsg('Requirement appended');
      setRequirementText('');
      getProject();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProjectLoading(false);
    }
  }, [projectIdInput, requirementText, getProject]);

  const updateStack = useCallback(async () => {
    if (!projectIdInput.trim()) return;
    setProjectLoading(true);
    setError('');
    setWriteMsg('');
    try {
      const body: Record<string, string> = {};
      if (stackFrontend.trim()) body.frontend = stackFrontend.trim();
      if (stackBackend.trim()) body.backend = stackBackend.trim();
      const res = await fetch(`${BRAIN_API}/brain/projects/${projectIdInput.trim()}/stack`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Update stack failed: ${res.status}`);
      setWriteMsg('Stack updated');
      getProject();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProjectLoading(false);
    }
  }, [projectIdInput, stackFrontend, stackBackend, getProject]);

  const fetchMemory = useCallback(async () => {
    if (!sessionId.trim()) return;
    setLoading(true);
    setError('');
    setWriteMsg('');
    try {
      const [memRes, sessionRes] = await Promise.all([
        fetch(`${BRAIN_API}/brain/memory/debug/${sessionId.trim()}`),
        fetch(`${BRAIN_API}/brain/memory/debug/${sessionId.trim()}/session`),
      ]);
      if (!memRes.ok) throw new Error(`Memory fetch failed: ${memRes.status}`);
      const memData = await memRes.json();
      setEntries(memData.entries || []);
      if (sessionRes.ok) {
        const sData = await sessionRes.json();
        setSessionData(sData.data);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const fetchProductionSession = useCallback(async () => {
    if (!sessionId.trim()) return;
    setWriteMsg('');
    try {
      const res = await fetch(`${BRAIN_API}/brain/memory/session/${sessionId.trim()}`);
      if (!res.ok) throw new Error(`GET failed: ${res.status}`);
      const data = await res.json();
      setSessionData(data.data);
      setWriteMsg(data.exists ? 'Session loaded (prod endpoint)' : 'Session empty (prod endpoint)');
    } catch (e: any) {
      setError(e.message);
    }
  }, [sessionId]);

  const updateSessionField = useCallback(async () => {
    if (!sessionId.trim() || !sessionField) return;
    setWriteMsg('');
    try {
      const res = await fetch(`${BRAIN_API}/brain/memory/session/${sessionId.trim()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: sessionField, value: sessionValue }),
      });
      if (!res.ok) throw new Error(`PUT failed: ${res.status}`);
      setWriteMsg(`Field "${sessionField}" = "${sessionValue}" updated`);
      fetchProductionSession();
    } catch (e: any) {
      setError(e.message);
    }
  }, [sessionId, sessionField, sessionValue, fetchProductionSession]);

  const updateWorkflow = useCallback(async () => {
    if (!sessionId.trim()) return;
    setWriteMsg('');
    try {
      const res = await fetch(
        `${BRAIN_API}/brain/memory/session/${sessionId.trim()}/workflow?state=${encodeURIComponent(wfState)}&agent=${encodeURIComponent(wfAgent)}`,
        { method: 'PUT' }
      );
      if (!res.ok) throw new Error(`Workflow PUT failed: ${res.status}`);
      setWriteMsg(`Workflow → state="${wfState}", agent="${wfAgent}"`);
      fetchProductionSession();
    } catch (e: any) {
      setError(e.message);
    }
  }, [sessionId, wfState, wfAgent, fetchProductionSession]);

  const clearSession = useCallback(async () => {
    if (!sessionId.trim()) return;
    setWriteMsg('');
    try {
      const res = await fetch(`${BRAIN_API}/brain/memory/session/${sessionId.trim()}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`DELETE failed: ${res.status}`);
      setWriteMsg('Session cleared');
      setSessionData(null);
      fetchProductionSession();
    } catch (e: any) {
      setError(e.message);
    }
  }, [sessionId, fetchProductionSession]);

  return (
    <div className="min-h-screen bg-[#0d0c14] text-white p-6">
      <h1 className="text-xl font-bold mb-2">Memory & Session Debug</h1>
      <p className="text-xs text-gray-500 mb-4">Backend: {BRAIN_API}</p>

      <div className="flex gap-4 mb-6">
        <input
          className="flex-1 bg-[#1a1a2e] border border-white/10 rounded px-3 py-2 text-sm font-mono"
          placeholder="Paste a conversation / session ID..."
          value={sessionId}
          onChange={(e) => { setSessionId(e.target.value); setSessionData(null); setEntries([]); }}
          onKeyDown={(e) => e.key === 'Enter' && fetchMemory()}
        />
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-500/30 rounded p-3 text-sm mb-4">{error}</div>
      )}

      {writeMsg && (
        <div className="bg-green-900/30 border border-green-500/30 rounded p-3 text-sm mb-4">{writeMsg}</div>
      )}

      <div className="mb-8 mt-2 pt-6 border-t border-white/10">
        <h2 className="text-lg font-bold mb-4">Project Memory</h2>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ─── Create ─── */}
          <div className="bg-[#1a1a2e] border border-white/10 rounded p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Create Project</h3>
            <div className="space-y-2">
              <input value={newProjectName} onChange={e => setNewProjectName(e.target.value)}
                placeholder="name *" className="w-full bg-[#0d0c14] border border-white/10 rounded px-3 py-1.5 text-sm" />
              <input value={newProjectDesc} onChange={e => setNewProjectDesc(e.target.value)}
                placeholder="description" className="w-full bg-[#0d0c14] border border-white/10 rounded px-3 py-1.5 text-sm" />
              <input value={newProjectOwner} onChange={e => setNewProjectOwner(e.target.value)}
                placeholder="owner_id *" className="w-full bg-[#0d0c14] border border-white/10 rounded px-3 py-1.5 text-sm" />
              <button onClick={createProject} disabled={!newProjectName.trim() || !newProjectOwner.trim() || projectLoading}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 px-3 py-1.5 rounded text-xs font-medium w-full">
                {projectLoading ? '...' : 'POST /brain/projects'}
              </button>
            </div>
          </div>

          {/* ─── List / Get ─── */}
          <div className="bg-[#1a1a2e] border border-white/10 rounded p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">List & Get</h3>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input value={ownerId} onChange={e => { setOwnerId(e.target.value); setProjects([]); }}
                  placeholder="owner_id" className="flex-1 bg-[#0d0c14] border border-white/10 rounded px-3 py-1.5 text-sm" />
                <button onClick={listProjects} disabled={!ownerId.trim() || projectLoading}
                  className="bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap">
                  List
                </button>
              </div>
              <div className="flex gap-2">
                <input value={projectIdInput} onChange={e => { setProjectIdInput(e.target.value); setProjectDetail(null); }}
                  placeholder="project_id" className="flex-1 bg-[#0d0c14] border border-white/10 rounded px-3 py-1.5 text-sm" />
                <button onClick={getProject} disabled={!projectIdInput.trim() || projectLoading}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap">
                  Get
                </button>
              </div>
              {projects.length > 0 && (
                <div className="max-h-40 overflow-y-auto space-y-1 mt-2">
                  {projects.map((p: any) => (
                    <div key={p.id} className="flex items-center gap-2 bg-white/5 rounded px-2 py-1">
                      <span className="text-xs font-mono text-gray-300 truncate flex-1">{p.name}</span>
                      <button onClick={() => { setProjectIdInput(p.id); getProject(); }}
                        className="text-[10px] text-cyan-400 hover:text-cyan-300 whitespace-nowrap">
                        {p.id?.substring(0, 8)}...
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ─── Mutate ─── */}
          <div className="bg-[#1a1a2e] border border-white/10 rounded p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Mutate Project</h3>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input value={requirementText} onChange={e => setRequirementText(e.target.value)}
                  placeholder="requirement text" className="flex-1 bg-[#0d0c14] border border-white/10 rounded px-3 py-1.5 text-sm" />
                <button onClick={appendRequirement} disabled={!projectIdInput.trim() || !requirementText.trim() || projectLoading}
                  className="bg-amber-600 hover:bg-amber-700 disabled:opacity-40 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap">
                  + Req
                </button>
              </div>
              <div className="flex gap-2">
                <input value={stackFrontend} onChange={e => setStackFrontend(e.target.value)}
                  placeholder="frontend (e.g. React)" className="flex-1 bg-[#0d0c14] border border-white/10 rounded px-3 py-1.5 text-sm" />
                <input value={stackBackend} onChange={e => setStackBackend(e.target.value)}
                  placeholder="backend (e.g. Node)" className="flex-1 bg-[#0d0c14] border border-white/10 rounded px-3 py-1.5 text-sm" />
              </div>
              <button onClick={updateStack} disabled={!projectIdInput.trim() || projectLoading}
                className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 px-3 py-1.5 rounded text-xs font-medium w-full">
                PATCH stack
              </button>
            </div>
          </div>

        </div>

        {/* ─── Project Detail ─── */}
        {projectDetail && (
          <div className="bg-[#1a1a2e] border border-white/10 rounded p-4 mt-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Project Detail</h3>
            <pre className="text-xs text-gray-300 whitespace-pre-wrap break-all max-h-80 overflow-y-auto">
              {JSON.stringify(projectDetail, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ─── LEFT: Write Controls ─── */}
        <div className="space-y-6">
          <div className="flex gap-2">
            <button onClick={fetchMemory} disabled={!sessionId.trim() || loading}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 px-4 py-2 rounded text-sm font-medium">
              {loading ? 'Loading...' : 'Fetch Short-Term + Session (debug)'}
            </button>
            <button onClick={fetchProductionSession} disabled={!sessionId.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 px-4 py-2 rounded text-sm font-medium">
              Fetch Session (prod)
            </button>
          </div>

          <div className="bg-[#1a1a2e] border border-white/10 rounded p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Set Session Field</h3>
            <div className="flex gap-2 mb-2">
              <input value={sessionField} onChange={e => setSessionField(e.target.value)}
                placeholder="field name" className="flex-1 bg-[#0d0c14] border border-white/10 rounded px-3 py-1.5 text-sm" />
              <input value={sessionValue} onChange={e => setSessionValue(e.target.value)}
                placeholder="value" className="flex-1 bg-[#0d0c14] border border-white/10 rounded px-3 py-1.5 text-sm" />
            </div>
            <button onClick={updateSessionField} disabled={!sessionId.trim() || !sessionField}
              className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 px-3 py-1.5 rounded text-xs font-medium">
              PUT field
            </button>
          </div>

          <div className="bg-[#1a1a2e] border border-white/10 rounded p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Update Workflow State</h3>
            <div className="flex gap-2 mb-2">
              <select value={wfState} onChange={e => setWfState(e.target.value)}
                className="flex-1 bg-[#0d0c14] border border-white/10 rounded px-3 py-1.5 text-sm">
                <option value="starting">starting</option>
                <option value="planning">planning</option>
                <option value="clarifying">clarifying</option>
                <option value="todo_generation">todo_generation</option>
                <option value="building">building</option>
                <option value="reviewing">reviewing</option>
                <option value="done">done</option>
                <option value="error">error</option>
              </select>
              <input value={wfAgent} onChange={e => setWfAgent(e.target.value)}
                placeholder="agent name" className="flex-1 bg-[#0d0c14] border border-white/10 rounded px-3 py-1.5 text-sm" />
            </div>
            <div className="flex gap-2">
              <button onClick={updateWorkflow} disabled={!sessionId.trim()}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-40 px-3 py-1.5 rounded text-xs font-medium">
                PUT workflow
              </button>
              <button onClick={clearSession} disabled={!sessionId.trim()}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-40 px-3 py-1.5 rounded text-xs font-medium">
                DELETE session
              </button>
            </div>
          </div>

          <div className="bg-[#1a1a2e] border border-white/10 rounded p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Presets (select then PUT)</h3>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Start', state: 'starting', agent: 'LeaderAgent' },
                { label: 'Plan', state: 'planning', agent: 'PlannerAgent' },
                { label: 'Clarify', state: 'clarifying', agent: 'QuestionsAgent' },
                { label: 'Tasks', state: 'todo_generation', agent: 'TodoAgent' },
                { label: 'Build', state: 'building', agent: 'BuilderAgent' },
                { label: 'Done', state: 'done', agent: 'RunnerAgent' },
                { label: 'Error', state: 'error', agent: '' },
              ].map(p => (
                <button key={p.label} onClick={() => {
                  setWfState(p.state);
                  setWfAgent(p.agent);
                }}
                  className="bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1 rounded text-xs">
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ─── RIGHT: Data Display ─── */}
        <div className="space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-gray-400 uppercase mb-2">
              Session State {sessionData && Object.keys(sessionData).length > 0 &&
                <span className="text-green-400">(active)</span>}
            </h2>
            {sessionData && Object.keys(sessionData).length > 0 ? (
              <table className="w-full text-xs border border-white/10 rounded overflow-hidden">
                <thead>
                  <tr className="bg-white/5">
                    <th className="text-left px-3 py-1.5 font-medium text-gray-400">Field</th>
                    <th className="text-left px-3 py-1.5 font-medium text-gray-400">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(sessionData).map(([k, v]) => (
                    <tr key={k} className="border-t border-white/5">
                      <td className="px-3 py-1.5 font-mono text-gray-400">{k}</td>
                      <td className="px-3 py-1.5 font-mono text-white break-all">
                        {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-gray-500 text-xs">No session data.</p>
            )}
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-400 uppercase mb-2">
              Short-Term Memory ({entries.length} entries)
            </h2>
            {entries.length === 0 && !loading && (
              <p className="text-gray-500 text-xs">No memory entries found.</p>
            )}
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {entries.map((entry, i) => (
                <div key={i} className="bg-[#1a1a2e] border border-white/10 rounded p-3 text-sm">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span className={entry.role === 'user' ? 'text-green-400' : 'text-blue-400'}>
                      {entry.role?.toUpperCase()}
                    </span>
                    <span>{entry.agent && `[${entry.agent}] `}{entry.timestamp}</span>
                  </div>
                  <div className="text-gray-200 whitespace-pre-wrap break-words line-clamp-3">{entry.content}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
