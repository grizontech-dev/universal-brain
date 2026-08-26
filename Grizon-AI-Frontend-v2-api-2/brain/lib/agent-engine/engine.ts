import { useExecutionStore } from '../../store/execution-store';
import { generateDynamicMessage, generateDynamicQuestions, generateSmartTodos } from '../agents/dynamic-prompts';

export interface AgentTask {
    agent: string;
    task: string;
    files: string[];
    dependencies?: string[];
}

export class AgentEngine {
    constructor() {}

    private isStopped(): boolean {
        return useExecutionStore.getState().isStopped;
    }

    async startExecution(prompt: string) {
        const store = useExecutionStore.getState();
        store.resetExecution();
        
        // 1. ANALYZING PHASE - Leader analyzes the prompt
        store.setPhase('ANALYZING');
        store.updateAgent('leader', { status: 'THINKING', currentTask: 'Analyzing project requirements' });
        store.setStreamingMessage("Analyzing your request and understanding the project scope...");
        if (this.isStopped()) return [];
        await this.delay(2000);
        
        if (this.isStopped()) return [];
        store.addTimelineEvent("Prompt received and parsed successfully.", "SUCCESS");
        store.addTimelineEvent("Identifying project type and complexity.", "INFO");
        
        // 2. PLANNING PHASE - Architect creates the plan
        store.setPhase('PLANNING');
        store.updateAgent('leader', { status: 'WORKING', currentTask: 'Coordinating architecture design' });
        store.updateAgent('planner', { status: 'THINKING', currentTask: 'Designing system architecture' });
        
        const stackMsg = generateDynamicMessage({ type: 'stack' });
        store.setStreamingMessage(stackMsg);
        if (this.isStopped()) return [];
        await this.delay(1500);
        
        if (this.isStopped()) return [];
        store.addFileOperation({ filename: 'architecture.md', operation: 'CREATE' });
        store.addTimelineEvent("Generating component hierarchy.", "INFO");
        if (this.isStopped()) return [];
        await this.delay(1500);
        store.updateFileOperation(store.fileOperations[store.fileOperations.length - 1]?.id || '', 'COMPLETED');
        
        store.addFileOperation({ filename: 'package.json', operation: 'CREATE' });
        store.updateAgent('planner', { status: 'WORKING', currentTask: 'Defining dependencies' });
        if (this.isStopped()) return [];
        await this.delay(1000);
        store.updateFileOperation(store.fileOperations[store.fileOperations.length - 1]?.id || '', 'COMPLETED');
        store.addTimelineEvent("Architecture plan generated with component tree.", "SUCCESS");
        
        // 3. QUESTIONING PHASE
        store.setPhase('QUESTIONING');
        store.updateAgent('planner', { status: 'DONE' });
        store.updateAgent('leader', { status: 'THINKING', currentTask: 'Formulating clarification questions' });
        
        store.setStreamingMessage("I have a few questions to ensure the output matches your vision.");
        const questions = generateDynamicQuestions(prompt);
        if (this.isStopped()) return [];
        await this.delay(1500);
        
        if (this.isStopped()) return [];
        store.addTimelineEvent(`Generated ${questions.length} clarification questions.`, "INFO");
        store.setPhase('WAITING_FOR_USER');
        store.updateAgent('leader', { status: 'IDLE' });
        
        return questions;
    }

    async resumeExecutionAfterAnswers(answers: Record<string, string>, prompt: string) {
        const store = useExecutionStore.getState();
        if (store.isStopped) return;
        
        store.setPhase('EXECUTING');
        store.addTimelineEvent("User answers received and analyzed.", "SUCCESS");
        store.updateAgent('leader', { status: 'WORKING', currentTask: 'Delegating build tasks' });
        
        store.setStreamingMessage("Initializing execution pipeline and assigning agents...");
        if (this.isStopped()) return;
        await this.delay(1500);
        
        if (this.isStopped()) return;
        // Generate smart todos based on the prompt
        const todos = generateSmartTodos(prompt);
        todos.forEach(t => store.addTodo({ text: t }));
        
        store.addTimelineEvent("Execution pipeline initialized with task queue.", "SUCCESS");
        store.addTimelineEvent("Agent roles assigned: Frontend Builder, Backend Builder.", "INFO");

        // Run agents in sequence
        await this.runOrchestratedBuild(prompt);
    }

    private async runOrchestratedBuild(prompt: string) {
        const store = useExecutionStore.getState();
        if (store.isStopped) return;
        const todos = store.dynamicTodos;
        
        // Phase 1: Frontend Agent builds UI components
        store.updateAgent('leader', { status: 'WORKING', currentTask: 'Supervising frontend build' });
        store.updateAgent('frontend', { status: 'THINKING', currentTask: 'Analyzing UI requirements' });
        
        const uiMsg = generateDynamicMessage({ type: 'ui' });
        store.setStreamingMessage(uiMsg);
        if (this.isStopped()) return;
        await this.delay(1000);
        
        if (this.isStopped()) return;
        store.updateAgent('frontend', { status: 'WORKING', currentTask: 'Building layout components' });
        
        const frontendFiles = [
            'app/layout.tsx',
            'components/sidebar.tsx',
            'components/hero.tsx',
            'components/ui/button.tsx',
            'components/ui/card.tsx',
            'context/theme-provider.tsx'
        ];
        
        // Process first batch of todos (frontend tasks)
        const frontendEnd = Math.min(Math.ceil(todos.length * 0.6), todos.length);
        for (let i = 0; i < frontendEnd; i++) {
            if (this.isStopped()) return;
            const todo = todos[i];
            store.updateTodo(todo.id, 'IN_PROGRESS');
            
            const fileName = frontendFiles[i % frontendFiles.length];
            store.addFileOperation({ filename: fileName, operation: 'CREATE' });
            
            store.setStreamingMessage(`Building: ${todo.text}`);
            await this.delay(1800);
            
            if (this.isStopped()) return;
            store.updateTodo(todo.id, 'COMPLETED');
            store.updateFileOperation(store.fileOperations[store.fileOperations.length - 1]?.id || '', 'COMPLETED');
            store.addTimelineEvent(`Completed: ${todo.text}`, "SUCCESS");
        }
        
        if (this.isStopped()) return;
        store.updateAgent('frontend', { status: 'DONE' });
        
        // Phase 2: Backend Agent builds API and logic
        store.updateAgent('leader', { status: 'WORKING', currentTask: 'Supervising backend build' });
        store.updateAgent('backend', { status: 'THINKING', currentTask: 'Designing API routes' });
        
        const backendMsg = generateDynamicMessage({ type: 'backend' });
        store.setStreamingMessage(backendMsg);
        if (this.isStopped()) return;
        await this.delay(1000);
        
        if (this.isStopped()) return;
        store.updateAgent('backend', { status: 'WORKING', currentTask: 'Implementing server logic' });
        
        const backendFiles = [
            'api/routes.ts',
            'lib/auth.ts',
            'db/schema.ts',
            'lib/validators.ts'
        ];
        
        // Process remaining todos (backend tasks)
        for (let i = frontendEnd; i < todos.length; i++) {
            if (this.isStopped()) return;
            const todo = todos[i];
            store.updateTodo(todo.id, 'IN_PROGRESS');
            
            const fileName = backendFiles[(i - frontendEnd) % backendFiles.length];
            store.addFileOperation({ filename: fileName, operation: 'CREATE' });
            
            store.setStreamingMessage(`Implementing: ${todo.text}`);
            await this.delay(1800);
            
            if (this.isStopped()) return;
            store.updateTodo(todo.id, 'COMPLETED');
            store.updateFileOperation(store.fileOperations[store.fileOperations.length - 1]?.id || '', 'COMPLETED');
            store.addTimelineEvent(`Completed: ${todo.text}`, "SUCCESS");
        }
        
        if (this.isStopped()) return;
        store.updateAgent('backend', { status: 'DONE' });
        
        // Phase 3: Final sync
        store.setPhase('SYNCING');
        store.updateAgent('leader', { status: 'WORKING', currentTask: 'Syncing generated files' });
        store.setStreamingMessage("All components built. Syncing files to sandbox environment...");
        
        store.addFileOperation({ filename: 'node_modules/', operation: 'INSTALL' });
        if (this.isStopped()) return;
        await this.delay(1500);
        store.updateFileOperation(store.fileOperations[store.fileOperations.length - 1]?.id || '', 'COMPLETED');
        
        if (this.isStopped()) return;
        store.addTimelineEvent("Dependencies installed.", "SUCCESS");
        
        store.updateAgent('leader', { status: 'DONE' });
        store.setStreamingMessage("Build complete. Preview is ready.");
        
        store.addTimelineEvent("Application generated and synced successfully.", "SUCCESS");
        if (this.isStopped()) return;
        await this.delay(500);
        
        if (this.isStopped()) return;
        store.setPhase('COMPLETED');
    }

    private delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const agentEngine = new AgentEngine();
