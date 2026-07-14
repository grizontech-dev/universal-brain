// Dynamic AI message generation based on project type and complexity.

const STACK_MESSAGES = [
    "Analyzing existing Tailwind configuration to prepare design tokens.",
    "Mapping out component boundaries for optimal React hydration.",
    "Detected potential state management complexity. Preparing Zustand store structures.",
    "Setting up Framer Motion wrappers for fluid UI transitions.",
    "Inspecting Next.js routing requirements for optimal layout nesting.",
    "Preparing shadcn/ui component primitives for consistent design system.",
    "Configuring TypeScript strict mode for maximum type safety.",
    "Setting up ESLint and Prettier for code quality enforcement."
];

const BACKEND_MESSAGES = [
    "Detected authentication requirements. Preparing middleware layers.",
    "Structuring scalable API routes to handle real-time data.",
    "Optimizing database schema definitions for Supabase integration.",
    "Preparing robust error handling boundaries for the execution pipeline.",
    "Setting up rate limiting and request validation schemas.",
    "Configuring database connection pooling for optimal performance.",
    "Implementing JWT token refresh logic for seamless auth flow."
];

const UI_MESSAGES = [
    "Detected a highly animated requirement. Preparing reusable motion architecture.",
    "Exploring premium UI aesthetics. Switching to glassmorphism layer system.",
    "Your prompt requires complex dashboard orchestration. Restructuring grid layout.",
    "Assembling responsive breakpoints for seamless mobile experience.",
    "Creating adaptive color system with dark/light mode support.",
    "Building accessible form components with proper ARIA labels.",
    "Designing micro-interaction patterns for enhanced user engagement."
];

const GENERAL_MESSAGES = [
    "Analyzing project requirements and identifying key deliverables.",
    "Breaking down complex tasks into manageable implementation units.",
    "Evaluating technology choices against project constraints.",
    "Preparing development environment configuration."
];

export function generateDynamicMessage(context: { type: 'ui' | 'backend' | 'stack' | 'general' }): string {
    const arr = context.type === 'ui' ? UI_MESSAGES 
              : context.type === 'backend' ? BACKEND_MESSAGES
              : context.type === 'stack' ? STACK_MESSAGES
              : GENERAL_MESSAGES;
              
    return arr[Math.floor(Math.random() * arr.length)];
}

export function generateDynamicQuestions(prompt: string): string[] {
    const lowerPrompt = prompt.toLowerCase();
    
    if (lowerPrompt.includes('dashboard')) {
        return [
            "What data sources should the dashboard connect to?",
            "Do you need role-based access control (RBAC)?",
            "Which charting library do you prefer (Recharts, Chart.js, D3)?",
            "Should the dashboard support real-time WebSocket updates?"
        ];
    }
    
    if (lowerPrompt.includes('landing') || lowerPrompt.includes('portfolio')) {
        return [
            "Do you want dark/light mode toggle support?",
            "Should I implement scroll-triggered micro-animations?",
            "Do you need a CMS integration for dynamic content?",
            "Which sections should the landing page include?"
        ];
    }

    if (lowerPrompt.includes('api') || lowerPrompt.includes('backend')) {
        return [
            "What database system do you want to use?",
            "Do you need authentication and authorization?",
            "Should the API follow REST or GraphQL pattern?",
            "Do you need rate limiting and request validation?"
        ];
    }

    return [
        "Are there any specific color palettes or brand guidelines to follow?",
        "Will this application require user authentication?",
        "Do you need to integrate any third-party APIs?",
        "What is the expected scale of concurrent users?"
    ];
}

export function generateSmartTodos(prompt: string): string[] {
    const lowerPrompt = prompt.toLowerCase();
    const todos = ["Initialize project architecture", "Setup routing and layout layers"];
    
    if (lowerPrompt.includes('dashboard')) {
        todos.push(
            "Create dashboard layout with sidebar navigation",
            "Build analytics data visualization components",
            "Implement authentication system with role-based access",
            "Create data tables with sorting and filtering",
            "Build real-time data widgets",
            "Add export functionality for reports"
        );
    } else if (lowerPrompt.includes('landing') || lowerPrompt.includes('portfolio')) {
        todos.push(
            "Design hero section with call-to-action",
            "Build features/benefits grid section",
            "Create testimonials carousel component",
            "Implement pricing section with toggle",
            "Build responsive footer with newsletter signup",
            "Add smooth scroll animations and transitions"
        );
    } else if (lowerPrompt.includes('api') || lowerPrompt.includes('backend')) {
        todos.push(
            "Setup Express/Fastify server configuration",
            "Create database schema and migrations",
            "Implement authentication middleware",
            "Build RESTful API endpoints",
            "Add input validation and error handling",
            "Write API documentation"
        );
    } else {
        todos.push(
            "Create main application layout",
            "Build reusable UI component library",
            "Implement state management",
            "Create responsive navigation",
            "Build form components with validation",
            "Add loading states and error boundaries"
        );
    }
    
    return todos;
}
