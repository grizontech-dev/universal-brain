// Simulates dynamic AI log generation based on the project type and complexity.

const STACK_MESSAGES = [
    "Analyzing existing Tailwind configuration to prepare design tokens.",
    "Mapping out component boundaries for optimal React hydration.",
    "Detected potential state management complexity. Preparing Zustand store structures.",
    "Setting up Framer Motion wrappers for fluid UI transitions.",
    "Inspecting Next.js routing requirements for optimal layout nesting."
];

const BACKEND_MESSAGES = [
    "Detected authentication requirements. Preparing middleware layers.",
    "Structuring scalable API routes to handle real-time data.",
    "Optimizing database schema definitions for Supabase integration.",
    "Preparing robust error handling boundaries for the execution pipeline."
];

const UI_MESSAGES = [
    "Detected a highly animated requirement. Preparing reusable motion architecture.",
    "Exploring premium UI aesthetics. Switching to glassmorphism layer system.",
    "Your prompt requires complex dashboard orchestration. Restructuring grid layout.",
    "Assembling responsive breakpoints for seamless mobile experience."
];

export function generateDynamicMessage(context: { type: 'ui' | 'backend' | 'stack' | 'general' }): string {
    const arr = context.type === 'ui' ? UI_MESSAGES 
              : context.type === 'backend' ? BACKEND_MESSAGES
              : context.type === 'stack' ? STACK_MESSAGES
              : [...UI_MESSAGES, ...STACK_MESSAGES];
              
    return arr[Math.floor(Math.random() * arr.length)];
}

export function generateDynamicQuestions(prompt: string): string[] {
    const isDashboard = prompt.toLowerCase().includes('dashboard');
    const isLanding = prompt.toLowerCase().includes('landing') || prompt.toLowerCase().includes('portfolio');
    
    if (isDashboard) {
        return [
            "Do you need real-time analytics for this dashboard?",
            "Should I implement role-based access control (RBAC)?",
            "Which charting library do you prefer (e.g., Recharts)?"
        ];
    }
    
    if (isLanding) {
        return [
            "Do you want dark/light mode toggle support?",
            "Should I implement scroll-triggered micro-animations?",
            "Do you need a CMS for the blog section?"
        ];
    }

    return [
        "Are there any specific color palettes or brand guidelines I should follow?",
        "Will this application require user authentication?",
        "Do you need to integrate any third-party APIs?"
    ];
}

export function generateSmartTodos(prompt: string): string[] {
    const todos = ["Initialize project architecture", "Setup routing and layout layers"];
    
    if (prompt.toLowerCase().includes('dashboard')) {
        todos.push("Implement authentication system", "Create navigation sidebar", "Build analytics widgets", "Integrate data API layer");
    } else {
        todos.push("Create hero section", "Implement features grid", "Build responsive footer", "Add Framer Motion animations");
    }
    
    return todos;
}
