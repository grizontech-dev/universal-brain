/**
 * WebContainer command policy — allow real npm spawns, block CLI noise only.
 */

export type SpawnSpec = { program: string; args: string[] };

/** Supabase CLI only — not npm packages like @supabase/supabase-js */
export function isSupabaseCliCommand(cmd: string): boolean {
    const c = cmd.trim();
    if (!c) return false;
    if (/^supabase(\s|$)/i.test(c)) return true;
    if (/\bsupabase\s+(init|link|login|migration|db|start|stop)\b/i.test(c)) return true;
    return false;
}

export function isEchoInstruction(cmd: string): boolean {
    return /^echo\s+/i.test(cmd.trim());
}

export function isEnvCopyCommand(cmd: string): boolean {
    const c = cmd.trim().toLowerCase();
    return c.startsWith('cp .env') || c.includes('.env.example');
}

/** True when command should not run in WebContainer (log as skipped instruction). */
export function shouldSkipWebContainerCommand(cmd: string): boolean {
    const c = cmd.trim();
    if (!c) return true;
    if (isSupabaseCliCommand(c)) return true;
    if (isEchoInstruction(c)) return true;
    if (isEnvCopyCommand(c)) return true;
    if (/^npx\s+create[-\s]/i.test(c)) return true;
    return false;
}

/** `npm install` / `npm ci` with no package names (runner runs these at the end). */
export function isBareNpmInstall(cmd: string): boolean {
    const m = cmd.trim().match(/^npm\s+(install|ci)\b/i);
    if (!m) return false;
    const tail = cmd.trim().slice(m[0].length).trim();
    if (!tail) return true;
    const tokens = tail.split(/\s+/);
    const hasPackage = tokens.some((t) => t && !t.startsWith('-'));
    return !hasPackage;
}

export function parseNpmInstallPackages(cmd: string): string[] | null {
    const m = cmd.trim().match(/^npm\s+install\s+(.+)$/i);
    if (!m) return null;
    const tail = m[1].trim();
    if (!tail) return [];
    const packages: string[] = [];
    for (const token of tail.split(/\s+/)) {
        if (!token || token.startsWith('-')) continue;
        packages.push(token);
    }
    return packages;
}

export function devServerKey(cwdKey: string, cmd: string): string {
    const base = cmd.trim().toLowerCase().replace(/\s+/g, ' ');
    return `${cwdKey}::${base}`;
}

/** Prefer spawn(program, args) over jsh -c when we can parse safely. */
export function parseSpawnSpec(cmd: string): SpawnSpec {
    const trimmed = cmd.trim();

    const npmInstall = trimmed.match(/^npm\s+install\s*(.*)$/i);
    if (npmInstall) {
        const tail = (npmInstall[1] || '').trim();
        const args = ['install'];
        if (tail) {
            for (const token of tail.split(/\s+/)) {
                if (token) args.push(token);
            }
        }
        return { program: 'npm', args };
    }

    const npmCi = trimmed.match(/^npm\s+ci\b/i);
    if (npmCi) {
        const tail = trimmed.slice(npmCi[0].length).trim();
        const args = ['ci'];
        if (tail) {
            for (const token of tail.split(/\s+/)) {
                if (token) args.push(token);
            }
        }
        return { program: 'npm', args };
    }

    const npmRun = trimmed.match(/^npm\s+run\s+(\S+)(.*)$/i);
    if (npmRun) {
        const script = npmRun[1];
        const extra = (npmRun[2] || '').trim();
        const args = ['run', script];
        if (extra) {
            for (const token of extra.split(/\s+/)) {
                if (token) args.push(token);
            }
        }
        return { program: 'npm', args };
    }

    if (/^npm\s+start\b/i.test(trimmed)) {
        return { program: 'npm', args: ['start'] };
    }

    return { program: 'jsh', args: ['-c', trimmed] };
}

export function isLongRunningDevCommand(cmd: string): boolean {
    const c = cmd.toLowerCase();
    if (c.includes('install')) return false;
    return (
        c.includes('npm run dev') ||
        c.includes('vite') ||
        c.includes('next dev') ||
        c.includes('npm start') ||
        /node\s+.*server/i.test(c)
    );
}
