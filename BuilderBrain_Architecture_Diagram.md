# BuilderBrain — Ideal Architecture Diagram

## System Architecture

```mermaid
graph TB
    subgraph User["👤 User Layer"]
        Chat[Chat Interface]
        Canvas[Canvas + Editor]
        Preview[Live Preview]
        Dashboard[Dashboard]
    end

    subgraph API["🔌 API Gateway"]
        Auth[Auth + Rate Limit]
        Router[Smart Router]
        SSE[SSE Hub]
    end

    subgraph Brain["🧠 AI Brain"]
        Orchestrator[Orchestrator]
        
        subgraph Agents["Agent Fleet"]
            Manager[Manager Agent]
            Planner[Planner Agent]
            Builder[Builder Agent]
            Frontend[Frontend Agent]
            Backend[Backend Agent]
            Database[Database Agent]
            Reviewer[Quality Reviewer]
            Debugger[Debugger Agent]
        end
        
        subgraph Memory["Memory System"]
            ShortTerm[Short-Term<br/>Redis 3h]
            Session[Session<br/>Redis 24h]
            Project[Project<br/>PostgreSQL]
            Decisions[Decisions<br/>PostgreSQL]
            Execution[Execution<br/>PostgreSQL]
            Artifacts[Artifacts<br/>PostgreSQL]
            Errors[Errors<br/>PostgreSQL + FTS]
            LongTerm[Long-Term<br/>Qdrant Vectors]
            Impact[Impact Analysis<br/>Qdrant]
        end
    end

    subgraph Sandbox["🏖️ Sandbox"]
        MCP[MCP Server]
        Workspace[Workspace Files]
        Tunnel[Cloudflare Tunnel]
        Preview2[Live Preview]
    end

    subgraph Storage["💾 Storage"]
        PG[(PostgreSQL<br/>+ pgvector)]
        Redis[(Redis)]
        Qdrant[(Qdrant)]
        S3[(S3/Local)]
    end

    subgraph Integrations["🔗 Integrations"]
        GitHub[GitHub MCP]
        Supabase[Supabase MCP]
        Deploy[Deploy MCP]
    end

    Chat --> API
    Canvas --> API
    Preview --> API
    Dashboard --> API
    
    API --> Brain
    Brain --> Sandbox
    Brain --> Storage
    Brain --> Integrations
    
    Sandbox --> Preview2
```

## Agent Communication Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant API as API Gateway
    participant O as Orchestrator
    participant M as Manager
    participant P as Planner
    participant T as Todo
    participant B as Builder
    participant FA as Frontend Agent
    participant BA as Backend Agent
    participant DA as Database Agent
    participant R as Reviewer
    participant S as Sandbox

    U->>F: "Build me a dashboard"
    F->>API: POST /brain/chat
    API->>O: Route to Brain
    
    O->>M: Analyze intent
    M->>M: Check context completeness
    
    alt Context Missing
        M-->>O: needs_clarification
        O-->>F: Questions
        F-->>U: "What data?"
        U->>F: "Sales data"
        F->>API: POST /brain/chat
        API->>O: Route to Brain
        O->>M: Re-evaluate
    end
    
    M-->>O: ready_to_plan
    O->>P: Create roadmap
    P-->>O: Strategic plan
    O-->>F: Plan display
    F-->>U: Review plan
    
    U->>F: "Approve"
    F->>API: POST /brain/chat
    API->>O: Route to Brain
    O->>T: Generate tasks
    T-->>O: Task list
    
    loop For each task
        O->>B: Execute task
        B->>FA: Frontend task
        FA->>FA: Generate code
        FA-->>B: Files + commands
        
        B->>R: Review output
        R-->>B: Pass/Fail
        
        alt Failed
            B->>FA: Retry with feedback
        end
        
        B->>S: Write files to workspace
        S-->>B: Confirmation
    end
    
    O->>S: Deploy to sandbox
    S-->>F: Tunnel URL
    F-->>U: Live preview
```

## Memory Architecture

```mermaid
graph TB
    subgraph Gateway["MemoryGateway"]
        BuildCtx["build_agent_context()<br/>Assembles full context"]
        AnalyzeImpact["analyze_change_impact()<br/>Vector similarity search"]
    end

    subgraph Redis["Redis Layer"]
        ST[ShortTerm<br/>3h TTL]
        SS[Session<br/>24h TTL]
        AW[AgentWorking<br/>6h TTL]
    end

    subgraph PG["PostgreSQL Layer"]
        PR[Project<br/>CRUD]
        DC[Decision<br/>Override support]
        EX[Execution<br/>Status tracking]
        AR[Artifact<br/>Versioning]
        RV[Review<br/>Score + Issues]
        ER[Error<br/>Full-text search]
        SK[Skill<br/>Performance]
        AC[Architecture<br/>Success rate]
        CH[Change<br/>Request tracking]
    end

    subgraph Vector["Qdrant Layer"]
        LT[LongTerm<br/>Semantic search]
        IM[Impact<br/>Dependency graph]
    end

    BuildCtx --> Redis
    BuildCtx --> PG
    AnalyzeImpact --> Vector
    
    BuildCtx -->|"conversation"| ST
    BuildCtx -->|"decisions"| DC
    BuildCtx -->|"project"| PR
    BuildCtx -->|"errors"| ER
    BuildCtx -->|"execution"| EX
    BuildCtx -->|"artifacts"| AR
```

## Sandbox Flow

```mermaid
graph LR
    subgraph Brain["Brain"]
        BA[Builder Agent]
        RA[Runner Agent]
    end

    subgraph Local["Local Workspace"]
        Files[Files on Disk]
    end

    subgraph MCP["MCP Sandbox Server"]
        Archive[Archive + Base64]
        Execute[Execute Commands]
        Tunnel2[Create Tunnel]
    end

    subgraph Preview3["Live Preview"]
        URL[Cloudflare Tunnel URL]
        iframe[Preview iframe]
    end

    BA -->|"client_save_code"| Files
    RA -->|"deploy_workspace"| Archive
    Archive --> Execute
    Execute --> Tunnel2
    Tunnel2 --> URL
    URL --> iframe
```

## What BuilderBrain Needs to Be World-Class

```mermaid
mindmap
  root((BuilderBrain))
    AI Engine
      Multi-Agent Pipeline
      Smart Routing
      Quality Review
      Self-Healing
    Memory
      Short-term
      Long-term Vectors
      Project Context
      Error Learning
    Sandbox
      Isolated Execution
      Live Preview
      Tunnel URLs
      Persistent Sessions
    Integrations
      GitHub
      Supabase
      Deploy (Vercel/Netlify)
      Docker
    UX
      Chat Interface
      Code Editor
      Visual Builder
      Real-time Collaboration
    Production
      CI/CD Pipeline
      Monitoring
      Error Tracking
      Cost Analytics
```

## Key Differentiators vs Competitors

| Feature | BuilderBrain | Lovable | Bolt | Devin |
|---|---|---|---|---|
| Multi-Agent System | ✅ 13 agents | ❌ | ❌ | ✅ |
| Memory Architecture | ✅ 12 types | ⚠️ | ⚠️ | ✅ |
| MCP Connectors | ✅ GitHub, Supabase | ❌ | ❌ | ✅ |
| Quality Review | ✅ Auto review | ❌ | ❌ | ⚠️ |
| Impact Analysis | ✅ Vector search | ❌ | ❌ | ❌ |
| Error Learning | ✅ Full-text search | ❌ | ❌ | ⚠️ |
| Framework Support | ⚠️ React, Next.js | ✅ Many | ✅ Many | ✅ Many |
| One-Click Deploy | ❌ | ✅ | ✅ | ✅ |
| Production Ready | ❌ | ✅ | ✅ | ✅ |

## Recommended Priority

1. **Security** — Add auth to Brain endpoints, fix CORS
2. **Deployment** — One-click deploy to Vercel/Netlify
3. **More Frameworks** — Add Vue, Svelte, Angular templates
4. **Testing** — Unit tests for agents and memory
5. **CI/CD** — GitHub Actions pipeline
6. **Monitoring** — Sentry + analytics
7. **Collaboration** — Multi-user real-time editing
8. **Mobile** — React Native support
