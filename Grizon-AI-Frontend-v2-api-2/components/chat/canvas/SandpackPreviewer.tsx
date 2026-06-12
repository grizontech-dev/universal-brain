'use client';

import React, { useEffect, useState, useRef } from 'react';
import {
    SandpackProvider,
    SandpackLayout,
    SandpackCodeEditor,
    SandpackPreview,
    SandpackFileExplorer,
    useSandpack,
    useActiveCode
} from "@codesandbox/sandpack-react";
import * as themes from "@codesandbox/sandpack-themes";
import { useCanvas } from '@/context/CanvasContext';
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { LanguageSupport, StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { loadPyodide } from "pyodide";
import { Database, Sparkles, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

/* =========================
   CONSTANTS
========================= */

const ALL_THEMES = {
    "Level Up": themes.levelUp,
    "Dracula": themes.dracula,
    "Cyberpunk": themes.cyberpunk,
    "Night Owl": themes.nightOwl,
    "Monokai Pro": themes.monokaiPro,
    "Atom Dark": themes.atomDark,
};

interface ProjectFile {
    path: string;
    content: string;
}

interface Props {
    files: ProjectFile[];
    template?: string;
    isStreaming?: boolean;
}

/* =========================
   PYODIDE
========================= */

let pyodidePromise: Promise<any> | null = null;

async function getPyodide() {
    if (!pyodidePromise) {
        pyodidePromise = loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/"
        });
    }
    return pyodidePromise;
}

/* =========================
   HELPERS (Smart Mapping)
========================= */

const normalize = (p: string) => p.startsWith('/') ? p : '/' + p;

const getFrontendDir = (files: ProjectFile[]): string => {
    const paths = files.map(f => normalize(f.path).substring(1));
    for (const dir of ['frontend/', 'client/', 'app/', 'web/', 'ui/']) {
        if (paths.some(p => p.startsWith(dir))) return dir;
    }
    return '';
};

const repairJson = (raw: string): string => {
    try { JSON.parse(raw); return raw; } catch {
        const f = raw.indexOf('{'), l = raw.lastIndexOf('}');
        if (f !== -1 && l > f) { try { const s = raw.substring(f, l + 1); JSON.parse(s); return s; } catch { } }
        return '{}';
    }
};

const processForStableReact = (files: ProjectFile[], connectors: any[]): { files: Record<string, { code: string }>, dependencies: Record<string, string> } => {
    const result: Record<string, { code: string }> = {};
    const normalized = files.map(f => ({ ...f, path: normalize(f.path) }));

    const supabase = connectors.find(c => c.type === 'supabase' && c.isActive) || 
                     connectors.find(c => c.type === 'supabase-account' && c.isActive);
    let supabaseUrl = supabase?.config?.url || '';
    let supabaseKey = supabase?.config?.anonKey || '';
    let projectId = supabase?.config?.projectId || '';

    // If projectId is missing, try to extract it from the URL (e.g. https://abc.supabase.co -> abc)
    if (!projectId && supabaseUrl) {
        const match = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/);
        if (match) projectId = match[1];
    }

    // Monorepo Mapping: Flatten frontend files but PRESERVE backend/other files
    const frontendDir = getFrontendDir(normalized);
    const workingFiles = normalized.map(f => {
        const pathNoSlash = f.path.substring(1);
        if (frontendDir && pathNoSlash.startsWith(frontendDir)) {
            // Remap frontend/src/App.jsx -> /src/App.jsx
            return { ...f, path: '/' + pathNoSlash.replace(frontendDir, '') };
        }
        return f;
    });

    workingFiles.forEach(f => {
        let p = f.path;
        let content = f.content;

        // Remap /src/App.jsx -> /App.jsx
        if (p.startsWith('/src/')) {
            p = p.replace('/src/', '/');
        }

        // AUTO-REPAIR: Hard-inject Supabase credentials if available
        if (supabaseUrl) {
            content = content.replace(/process\.env\.VITE_SUPABASE_URL/g, `'${supabaseUrl}'`);
            content = content.replace(/import\.meta\.env\.VITE_SUPABASE_URL/g, `'${supabaseUrl}'`);
            content = content.replace(/process\.env\.SUPABASE_URL/g, `'${supabaseUrl}'`);
        }
        if (supabaseKey) {
            content = content.replace(/process\.env\.VITE_SUPABASE_ANON_KEY/g, `'${supabaseKey}'`);
            content = content.replace(/import\.meta\.env\.VITE_SUPABASE_ANON_KEY/g, `'${supabaseKey}'`);
            content = content.replace(/process\.env\.SUPABASE_ANON_KEY/g, `'${supabaseKey}'`);
        }

        // AUTO-REPAIR: Map any remaining Vite 'import.meta.env' to 'process.env'
        if (content.includes('import.meta.env')) {
            content = content.replace(/import\.meta\.env/g, 'process.env');
        }

        // Repair package.json if malformed
        if (p === '/package.json') content = repairJson(content);

        // AUTO-REPAIR: Map '@/...' imports to './...'
        content = content.replace(/from\s+['"]@\/(.*?)['"]/g, "from './$1'");
        content = content.replace(/import\s+['"]@\/(.*?)['"]/g, "import './$1'");

        result[p] = { code: content };
    });

    // Ensure index.css exists (even if empty) to prevent import errors in index.js
    if (!result['/index.css']) {
        result['/index.css'] = { code: '/* Default Styles */\nbody { margin: 0; font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif; }' };
    }

    // Determine the actual App entry point and consolidate to App.js
    // Priority: App.tsx > App.jsx > App.js > main.tsx > main.jsx > index.js
    let appFile: string | undefined = 
        Object.keys(result).find(k => k === '/App.tsx') ||
        Object.keys(result).find(k => k === '/App.jsx') ||
        Object.keys(result).find(k => k === '/App.js') ||
        Object.keys(result).find(k => k === '/main.tsx') ||
        Object.keys(result).find(k => k === '/main.jsx') ||
        Object.keys(result).find(k => k === '/index.js');

    // FALLBACK: If no explicit entry point found, look for ANY .jsx or .tsx file (excluding library files)
    if (!appFile) {
        appFile = Object.keys(result).find(k => (k.endsWith('.jsx') || k.endsWith('.tsx')) && k !== '/GrizonUI.js');
    }

    if (appFile) {
        // Move content to App.js and delete the original if it's different
        // This is necessary because our stable index.js expects App.js
        if (appFile !== '/App.js') {
            result['/App.js'] = { code: result[appFile].code };
            // If the original was just main/index, we can keep it or delete it. 
            // Deleting prevents confusion in the file explorer.
            if (appFile !== '/App.js') delete result[appFile];
        }
    } else {
        // ULTIMATE FALLBACK: Create a simple placeholder App.js if none exists
        result['/App.js'] = { 
            code: `import React from 'react';\nimport { Card, Button } from './GrizonUI';\n\nexport default function App() {\n  return (\n    <div className="p-8 flex items-center justify-center min-h-screen bg-base-300">\n      <Card className="max-w-md w-full">\n        <h1 className="text-2xl font-bold mb-4">Application Ready</h1>\n        <p className="mb-6 opacity-70">The database is setup and the workspace is ready. You can now start building your UI components or ask the AI to generate a specific dashboard.</p>\n        <Button className="w-full">Get Started</Button>\n      </Card>\n    </div>\n  );\n}`
        };
    }

    // Smart Dependency Management: Merge AI-provided package.json with defaults
    // Use fixed versions to prevent constant resolution lookups (speeds up load & prevents timeouts)
    const defaultDeps = {
        "react": "18.2.0",
        "react-dom": "18.2.0",
        "lucide-react": "0.284.0",
        "framer-motion": "10.16.4",
        "axios": "1.5.0",
        "clsx": "2.0.0",
        "tailwind-merge": "1.14.0"
    };

    // === DYNAMIC DEPENDENCY RESOLUTION ===
    const fromPkg: Record<string, string> = {};
    // Packages to ignore in the browser sandbox (already provided or irrelevant)
    const IGNORE_PACKAGES = new Set(['react', 'react-dom', 'vite', '@vitejs/plugin-react', 'typescript', 'esbuild', '@types/react', '@types/react-dom', '@types/node']);

    const aiPackageJson = result['/package.json'];
    if (aiPackageJson) {
        try {
            const parsed = JSON.parse(repairJson(aiPackageJson.code));
            const allDeps = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
            for (const [name, version] of Object.entries(allDeps)) {
                if (IGNORE_PACKAGES.has(name)) continue;
                fromPkg[name] = (version as string).replace(/[\^~>=<]/g, '').trim() || 'latest';
            }
        } catch (e) { }
    }

    // 2. Extract from imports in all script files
    const scriptFiles = Object.entries(result).filter(([path]) => 
        path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.ts') || path.endsWith('.tsx')
    );
    const allCode = scriptFiles.map(([_, f]) => f.code).join('\n');
    
    // Support for import X from 'pkg', import 'pkg', and require('pkg')
    const importRegex = /(?:import\s+(?:.*?\s+from\s+)?|require\s*\()\s*['"]([^./][^'"]*)['"]/g;
    const matches = allCode.matchAll(importRegex);
    const fromImports: Record<string, string> = {};
    
    const NODE_BUILTINS = new Set(['fs', 'path', 'os', 'crypto', 'http', 'https', 'stream', 'util', 'events', 'buffer', 'url', 'querystring']);

    const versionMap: Record<string, string> = {
        "react-router-dom": "6.16.0",
        "@supabase/supabase-js": "2.38.4",
        "lucide-react": "0.284.0",
        "framer-motion": "10.16.4",
        "axios": "1.5.0",
        "recharts": "2.8.0",
        "clsx": "2.0.0",
        "tailwind-merge": "1.14.0",
        "date-fns": "2.30.0",
        "react-icons": "4.11.0",
        "lodash": "4.17.21",
        "react-pdf": "7.3.3",
        "zod": "3.22.4",
        "zustand": "4.4.1",
        "react-hook-form": "7.46.1"
    };

    for (const match of matches) {
        const importPath = match[1];
        if (importPath.includes(':') || importPath.includes('\\')) continue;
        
        let pkgName = importPath;
        if (importPath.startsWith('@')) {
            pkgName = importPath.split('/').slice(0, 2).join('/');
        } else {
            pkgName = importPath.split('/')[0];
        }

        if (NODE_BUILTINS.has(pkgName) || IGNORE_PACKAGES.has(pkgName)) continue;
        
        if (!fromImports[pkgName]) {
            fromImports[pkgName] = versionMap[pkgName] || "latest";
        }
    }

    // 3. Merge: package.json (pinned) > imports (latest/mapped)
    const finalDeps = { ...fromImports, ...fromPkg };

    result['/package.json'] = {
        code: JSON.stringify({
            dependencies: {
                ...defaultDeps,
                ...finalDeps
            }
        }, null, 2)
    };

    result['/index.js'] = { code: STABLE_INDEX_JS };
    result['/index.html'] = { code: STABLE_INDEX_HTML };
    result['/GrizonUI.js'] = { code: STABLE_GRIZON_UI };

    return { 
        files: result, 
        dependencies: { ...defaultDeps, ...finalDeps } 
    };
};

/* =========================
   STABLE BOILERPLATE
========================= */

const STABLE_INDEX_JS = `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import "./index.css";

// VIRTUAL BACKEND PROXY: Mocks localhost:5000/api calls using localStorage
const originalFetch = window.fetch;
window.fetch = async (url, options) => {
  const urlStr = typeof url === 'string' ? url : url.url;
  if (urlStr.includes('localhost:5000') || urlStr.includes('/api/')) {
    console.log('🔗 Virtual Backend Intercepted:', urlStr);
    const dbKey = 'grizon_virtual_db';
    let db = JSON.parse(localStorage.getItem(dbKey) || '{"inventory": [], "users": [], "settings": {}}');
    
    if (urlStr.endsWith('/inventory')) {
      if (options?.method === 'POST') {
        const newItem = JSON.parse(options.body);
        newItem.id = Date.now();
        db.inventory.push(newItem);
        localStorage.setItem(dbKey, JSON.stringify(db));
        return new Response(JSON.stringify(newItem), { status: 201 });
      }
      return new Response(JSON.stringify(db.inventory), { status: 200 });
    }
    return new Response(JSON.stringify({ message: "Mock success" }), { status: 200 });
  }
  return originalFetch(url, options);
};

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}`;

const STABLE_INDEX_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/daisyui@latest/dist/full.css" rel="stylesheet" type="text/css" />
  <title>Grizon App</title>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;

const STABLE_GRIZON_UI = `import React from 'react';

export const Button = ({ children, variant = 'primary', className = '', ...props }) => (
  <button className={\`btn btn-\${variant} \${className}\`} {...props}>{children}</button>
);

export const Card = ({ children, className = '' }) => (
  <div className={\`card bg-base-200 shadow-xl \${className}\`}>
    <div className="card-body">{children}</div>
  </div>
);

export const Badge = ({ children, className = '' }) => (
  <span className={\`badge \${className}\`}>{children}</span>
);

export const Input = ({ className = '', ...props }) => (
  <input className={\`input input-bordered w-full \${className}\`} {...props} />
);
`;

/* =========================
   LOADING OVERLAY
========================= */

const SandpackLoadingOverlay = () => {
    const { sandpack, listen } = useSandpack();
    const [isBundling, setIsBundling] = useState(true);

    useEffect(() => {
        if (sandpack.status === "done" || sandpack.status === "timeout") setIsBundling(false);
        const unsub = listen((msg: any) => {
            if (msg.type === "start" || msg.type === "status") setIsBundling(true);
            if (msg.type === "done" || msg.type === "success") setTimeout(() => setIsBundling(false), 400);
            if (msg.type === "compile-error" || msg.type === "error") setIsBundling(false);
        });
        return unsub;
    }, [listen, sandpack.status]);

    if (!isBundling) return null;

    return (
        <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center gap-10 bg-[#08080c]">
            <div className="relative w-28 h-28">
                <div className="absolute inset-0 rounded-full border-2 border-purple-500/10 animate-[spin_4s_linear_infinite]" />
                <div className="absolute inset-4 rounded-full border-2 border-purple-500/20 animate-[spin_2s_linear_infinite_reverse]" />
                <div className="absolute inset-0 rounded-full border-t-2 border-purple-500 animate-[spin_1.5s_linear_infinite]" />
                <div className="absolute inset-10 rounded-full bg-purple-500/30 animate-pulse" />
            </div>
            <div className="px-8 py-3 bg-white/5 border border-white/10">
                <p className="text-[11px] font-black uppercase tracking-[0.6em] text-white/90 text-center">Orchestrating Workspace</p>
            </div>
        </div>
    );
};

/* =========================
   PYTHON PREVIEW
========================= */

const PythonPreview = () => {
    const { code } = useActiveCode();
    const [output, setOutput] = useState("Loading Python...");
    const pyRef = useRef<any>(null);

    useEffect(() => {
        getPyodide().then(py => {
            pyRef.current = py;
            setOutput("Python Ready");
        });
    }, []);

    useEffect(() => {
        if (!pyRef.current || !code) return;
        const run = async () => {
            try {
                await pyRef.current.runPythonAsync(code);
                const result = pyRef.current.runPython("str(_)");
                setOutput(result || "No Output");
            } catch (e: any) {
                setOutput("Error: " + e.message);
            }
        };
        const t = setTimeout(run, 400);
        return () => clearTimeout(t);
    }, [code]);

    return (
        <div className="flex-1 flex flex-col bg-[#050508] h-full overflow-hidden">
            <div className="h-10 border-b border-white/5 flex items-center px-4">
                <span className="text-[9px] font-black text-white/40 tracking-[0.2em] uppercase">Python Output</span>
            </div>
            <pre className="flex-1 p-8 font-mono text-[11px] text-yellow-500/80 overflow-auto whitespace-pre-wrap leading-relaxed custom-scrollbar">{output}</pre>
        </div>
    );
};

/* =========================
   MAIN COMPONENT
========================= */

export default function SandpackPreviewer({ files, template = "react", isStreaming }: Props) {
    const { connectors, refreshConnectors } = useCanvas();
    const [theme, setTheme] = useState("Level Up");
    const [viewMode, setViewMode] = useState<'full' | 'preview'>('full');
    const [setupStatus, setSetupStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [setupError, setSetupError] = useState<string | null>(null);

    // PERSISTENT WORKSPACE: Load from and Sync to LocalStorage for true persistence across reloads
    const [mergedFiles, setMergedFiles] = useState<ProjectFile[]>([]);
    const hasManuallyToggled = useRef(false);

    // Initialize from LocalStorage
    useEffect(() => {
        const storageKey = `grizon_workspace_${window.location.pathname}`;
        const saved = localStorage.getItem(storageKey);
        if (saved) {
            try {
                setMergedFiles(JSON.parse(saved));
            } catch (e) {
                console.error("Failed to load workspace from cache:", e);
            }
        }

        const setupKey = `grizon_setup_status_${window.location.pathname}`;
        const savedSetup = localStorage.getItem(setupKey);
        if (savedSetup === 'success') {
            setSetupStatus('success');
        }

        // Handle manual clear from chat (New Chat button)
        const handleClear = () => {
            setMergedFiles([]);
            setSetupStatus('idle');
            localStorage.removeItem(`grizon_workspace_${window.location.pathname}`);
            localStorage.removeItem(`grizon_setup_status_${window.location.pathname}`);
        };

        window.addEventListener('clear-chat-state', handleClear);
        return () => window.removeEventListener('clear-chat-state', handleClear);
    }, []);

    // Merge and Sync
    useEffect(() => {
        if (files && files.length > 0) {
            const updateFiles = () => {
                setMergedFiles(prev => {
                    const newFilesMap = new Map(prev.map(f => [f.path, f]));
                    files.forEach(f => newFilesMap.set(f.path, f));
                    const updated = Array.from(newFilesMap.values());

                    // Save to LocalStorage
                    const storageKey = `grizon_workspace_${window.location.pathname}`;
                    localStorage.setItem(storageKey, JSON.stringify(updated));

                    return updated;
                });
            };

            if (isStreaming) {
                const timer = setTimeout(updateFiles, 800);
                return () => clearTimeout(timer);
            } else {
                updateFiles();
            }
        }
    }, [files, isStreaming]);

    const sandpackData = React.useMemo(() => processForStableReact(mergedFiles, connectors), [mergedFiles, connectors]);
    const isPython = Object.keys(sandpackData.files).some(k => k.endsWith('.py'));

    // Autonomous Environment Injection: Automatically provide connected Supabase credentials to the sandbox
    const environmentVariables = React.useMemo(() => {
        const env: Record<string, string> = {};
        const supabase = connectors.find(c => c.type === 'supabase' && c.isActive);
        if (supabase && supabase.config) {
            env.VITE_SUPABASE_URL = supabase.config.url || '';
            env.VITE_SUPABASE_ANON_KEY = supabase.config.anonKey || '';
            // Also provide non-Vite prefixed for broad compatibility
            env.SUPABASE_URL = supabase.config.url || '';
            env.SUPABASE_ANON_KEY = supabase.config.anonKey || '';
        }
        return env;
    }, [connectors]);

    // AUTO-SWITCH to Live mode when a valid project is detected
    useEffect(() => {
        if (!hasManuallyToggled.current &&
            sandpackData.files['/App.js'] && 
            !sandpackData.files['/App.js'].code.includes('Application Ready') &&
            viewMode === 'full') {
            setViewMode('preview');
        }
    }, [sandpackData.files, viewMode]);

    const handleAutoSetup = async () => {
        setSetupStatus('error');
        setSetupError('Database automation is disabled in this UI-only build.');
    };


    return (
        <div className="absolute inset-0 bg-[#08080c] overflow-hidden flex flex-col">
            <style dangerouslySetInnerHTML={{
                __html: `
                .sp-wrapper,.sp-stack,.sp-pane,.sp-editor,.sp-preview,.sp-preview-container,.sp-preview-iframe,.sp-preview-iframe iframe {
                    height:100% !important; min-height:100% !important; display:flex !important; flex-direction:column !important;
                }
                .sp-layout {
                    height:100% !important; min-height:100% !important; display:flex !important; flex-direction:row !important;
                    border:none !important; border-radius:0 !important; background:transparent !important;
                }
                .sp-explorer { width:220px !important; flex:unset !important; height:100% !important; border-right:1px solid rgba(255,255,255,0.05) !important; }
                .sp-preview-iframe { background:white !important; flex:1 !important; }
                .custom-scrollbar::-webkit-scrollbar { width:4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background:transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.08); }
                .sp-cm { flex:1 !important; }
            ` }} />

            {/* ── CONTROLS ── */}
            <div className="absolute bottom-6 right-6 z-[110] flex items-center gap-2 bg-black/60 backdrop-blur-xl border border-white/10 p-1">
                <select
                    value={theme}
                    onChange={e => setTheme(e.target.value)}
                    className="bg-transparent text-[9px] font-black uppercase tracking-widest text-white/60 outline-none px-3 py-1.5 border-r border-white/10 cursor-pointer hover:text-white transition-all appearance-none"
                    style={{ WebkitAppearance: 'none' }}
                >
                    {Object.keys(ALL_THEMES).map(t => (
                        <option key={t} value={t} className="bg-[#0d0c14] text-white">{t}</option>
                    ))}
                </select>

                {(['full', 'preview'] as const).map(mode => (
                    <button
                        key={mode}
                        onClick={() => { setViewMode(mode); hasManuallyToggled.current = true; }}
                        className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${viewMode === mode ? 'bg-purple-600 text-white' : 'text-white/40 hover:text-white'}`}
                    >
                        {mode === 'full' ? 'IDE' : 'Live'}
                    </button>
                ))}

                <button
                    onClick={handleAutoSetup}
                    disabled={setupStatus === 'loading'}
                    title={setupError || 'Automate Database Setup'}
                    className={`flex items-center gap-2 px-4 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all border-l border-white/10 ${setupStatus === 'success' ? 'text-emerald-400 bg-emerald-500/10' :
                            setupStatus === 'error' ? 'text-red-400 bg-red-500/10' :
                                'text-purple-400 hover:bg-purple-500/10'
                        }`}
                >
                    {setupStatus === 'loading' ? <Loader2 size={12} className="animate-spin" /> :
                        setupStatus === 'success' ? <CheckCircle2 size={12} /> :
                            setupStatus === 'error' ? <AlertCircle size={12} /> :
                                <Sparkles size={12} />}
                    {setupStatus === 'loading' ? 'Setting up...' :
                        setupStatus === 'success' ? 'Setup Ready' :
                            setupStatus === 'error' ? 'Setup Failed' :
                                'Auto-Setup DB'}
                </button>
            </div>

            <SandpackProvider
                key="stable-react-v4"
                template={template as any}
                files={sandpackData.files}
                theme={(ALL_THEMES as any)[theme]}
                customSetup={{
                    dependencies: sandpackData.dependencies
                }}
                options={{
                    autorun: true,
                    externalResources: [
                        "https://cdn.tailwindcss.com",
                        "https://cdn.jsdelivr.net/npm/daisyui@latest/dist/full.css",
                        "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"
                    ],
                    recompileMode: "delayed",
                    recompileDelay: 1000,
                }}
            >
                <div className="flex-1 flex flex-row overflow-hidden relative">
                    {/* Preview View */}
                    <div className={`flex-1 h-full bg-[#08080c] relative ${viewMode === 'preview' ? 'flex flex-col' : 'hidden'}`}>
                        {isPython ? <PythonPreview /> : (
                            <>
                                <SandpackLoadingOverlay />
                                <SandpackPreview className="!h-full" showNavigator showRestartButton />
                            </>
                        )}
                    </div>

                    {/* IDE View */}
                    <div className={`flex-1 h-full ${viewMode === 'full' ? 'flex' : 'hidden'}`}>
                        <SandpackLayout className="flex-1 !border-none !rounded-none">
                            <SandpackFileExplorer className="!w-[220px] !min-w-[220px] !max-w-[220px] !h-full !bg-[#0c0c12] border-r border-white/5 custom-scrollbar" />
                            <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
                                <SandpackCodeEditor
                                    showTabs showLineNumbers showInlineErrors closableTabs wrapContent
                                    readOnly={true}
                                    className="flex-1"
                                    additionalLanguages={[
                                        { name: "python", extensions: ["py"], language: python() },
                                        { name: "java", extensions: ["java"], language: java() },
                                        { name: "shell", extensions: ["sh"], language: new LanguageSupport(StreamLanguage.define(shell)) },
                                    ]}
                                />
                            </div>
                            {isPython && (
                                <div className="relative min-w-[400px] h-full border-l border-white/5">
                                    <PythonPreview />
                                </div>
                            )}
                        </SandpackLayout>
                    </div>
                </div>
            </SandpackProvider>
        </div>
    );
}