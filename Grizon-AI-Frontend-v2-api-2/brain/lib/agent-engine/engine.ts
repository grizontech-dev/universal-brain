import { useExecutionStore } from '../../store/execution-store';
import { generateDynamicMessage, generateDynamicQuestions, generateSmartTodos } from '../agents/dynamic-prompts';

export class AgentEngine {
    constructor() {}

    async startExecution(prompt: string) {
        const store = useExecutionStore.getState();
        store.resetExecution();
        
        // 1. ANALYZING PHASE
        store.setPhase('ANALYZING');
        store.updateAgent('leader', { status: 'THINKING', currentTask: 'Analyzing prompt' });
        store.setStreamingMessage("I'm analyzing the project architecture and breaking down the requirements...");
        await this.delay(3000);
        
        store.addTimelineEvent("Prompt received and parsed.", "SUCCESS");
        
        // 2. PLANNING PHASE
        store.setPhase('PLANNING');
        store.updateAgent('leader', { status: 'WORKING', currentTask: 'Orchestrating agents' });
        store.updateAgent('planner', { status: 'THINKING', currentTask: 'Generating architecture' });
        
        const dynamicMsg = generateDynamicMessage({ type: 'stack' });
        store.setStreamingMessage(dynamicMsg);
        
        store.addFileOperation({ filename: 'architecture.md', operation: 'CREATE' });
        await this.delay(2000);
        store.updateFileOperation(store.fileOperations[store.fileOperations.length - 1]?.id || '', 'COMPLETED');
        store.addTimelineEvent("Architecture plan generated.", "SUCCESS");
        
        // 3. QUESTIONING PHASE (If needed)
        store.setPhase('QUESTIONING');
        store.updateAgent('planner', { status: 'DONE' });
        store.updateAgent('leader', { status: 'THINKING', currentTask: 'Formulating questions' });
        
        store.setStreamingMessage("I need a few clarifications before I start generating the code.");
        const questions = generateDynamicQuestions(prompt);
        await this.delay(2000);
        
        store.addTimelineEvent(`Generated ${questions.length} clarification questions.`, "INFO");
        store.setPhase('WAITING_FOR_USER');
        store.updateAgent('leader', { status: 'IDLE' });
        
        // Return questions to the UI so it can render a form
        return questions;
    }

    async resumeExecutionAfterAnswers(answers: Record<string, string>, prompt: string) {
        const store = useExecutionStore.getState();
        
        store.setPhase('EXECUTING');
        store.addTimelineEvent("User answers analyzed.", "SUCCESS");
        store.updateAgent('leader', { status: 'WORKING', currentTask: 'Delegating tasks' });
        
        store.setStreamingMessage("Answers received. Generating smart todos and initializing execution pipeline...");
        await this.delay(2000);
        
        const todos = generateSmartTodos(prompt);
        todos.forEach(t => store.addTodo({ text: t }));
        
        store.addTimelineEvent("Execution pipeline initialized.", "SUCCESS");

        // Kick off Frontend Builder
        this.runFrontendAgent();
    }

    private async runFrontendAgent() {
        const store = useExecutionStore.getState();
        store.updateAgent('frontend', { status: 'WORKING', currentTask: 'Building components' });
        
        const uiMsg = generateDynamicMessage({ type: 'ui' });
        store.setStreamingMessage(uiMsg);
        
        const fileNames = ['layout.tsx', 'sidebar.tsx', 'hero.tsx', 'theme-provider.ts'];
        
        for (const [index, todo] of store.dynamicTodos.entries()) {
            store.updateTodo(todo.id, 'IN_PROGRESS');
            
            store.addFileOperation({ filename: fileNames[index % fileNames.length], operation: 'CREATE' });
            
            await this.delay(2500);
            
            store.updateTodo(todo.id, 'COMPLETED');
            store.updateFileOperation(store.fileOperations[store.fileOperations.length - 1]?.id || '', 'COMPLETED');
        }

        store.setPhase('SYNCING');
        store.updateAgent('frontend', { status: 'DONE' });
        store.updateAgent('leader', { status: 'DONE' });
        store.setStreamingMessage("Execution complete. Syncing files to sandbox...");
        await this.delay(2000);
        
        store.setPhase('COMPLETED');
        store.addTimelineEvent("Application successfully generated and synced.", "SUCCESS");
        store.setStreamingMessage("All tasks finished successfully. The preview is now ready.");
    }

    private delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const agentEngine = new AgentEngine();
