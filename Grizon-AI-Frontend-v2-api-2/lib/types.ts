/** Mirrors backend profile (`/auth/me`); camelCase aliases kept for UI. */
export interface User {
    id: string;
    email: string;
    name?: string;
    phone?: string | null;
    phoneVerified?: boolean;
    /** @deprecated Do not persist access tokens; kept for legacy typings only */
    token?: string;
    createdAt?: string;
    updatedAt?: string;
    bio?: string;
    avatar?: string;
    /** Backend `avatar_url` */
    avatar_url?: string | null;
    locale?: string | null;
    timezone?: string | null;
    mfa_enabled?: boolean;
    has_password?: boolean;
    linked_providers?: Array<{ provider: 'google'; provider_email: string; linked_at: string }>;
    email_verified_at?: string | null;
    role?: 'user' | 'admin' | 'superadmin';
    status?: 'active' | 'banned' | 'suspended';
    subscription?: string;
    subscriptionStatus?: string;
    subscriptionExpiry?: string;
}

export interface UserUpdate {
    name?: string;
    phone?: string;
    bio?: string;
    avatar?: string;
    avatar_url?: string | null;
    locale?: string | null;
    timezone?: string | null;
    // Add other updateable fields
}

export interface LoginRequest {
    email: string;
    password?: string;
}

export interface RegisterRequest {
    email: string;
    password?: string;
    name: string;
}

/** Backend `POST /auth/check-email` data payload */
export interface CheckEmailResult {
    exists: boolean;
    has_password: boolean;
    has_google: boolean;
    suggested_action: 'login' | 'register';
}

export interface CheckEmailResponse {
    success: boolean;
    data?: CheckEmailResult;
    message?: string;
}

export interface AuthResponse {
    success: boolean;
    data?: User;
    message?: string;
    error?: string;
}

// Credit Types
export interface CreditBalance {
    available: number;
    reserved: number;
    total: number;
    lastRefreshedAt?: string;
}

export interface CreditTransaction {
    id: string;
    userId: string;
    amount: number;
    balanceAfter: number;
    type: string;
    reason?: string;
    createdAt: string;
}

export interface CreditHistoryResponse {
    success: boolean;
    data: {
        transactions: CreditTransaction[];
        pagination: Pagination;
    };
}

// Chat Types
export interface ChatMessageRequest {
    content: string;
    selectedModels: string[];
    conversationId?: string;
    documentIds?: string[];
    fileIds?: string[];
    attachments?: string[];
    documents?: string[];
    attachedDocumentIds?: string[];
    /** Passed to fetch; omitted from JSON body by caller */
    abortSignal?: AbortSignal;
    options?: {
        temperature?: number;
        maxTokens?: number;
        isVoiceMode?: boolean;
        language?: string;
        agent?: {
            name: string;
            role: string;
        };
        /** Active canvas artifact sent to the model for in-context editing */
        canvasContext?: {
            content: string;
            mode: 'document' | 'code' | 'render' | 'report' | 'markdown' | 'split';
        };
    };
}

export interface ChatEstimateResponse {
    success: boolean;
    data: {
        totalEstimatedCredits: number;
        sufficient: boolean;
        userBalance: number;
        estimatedTokens: {
            inputTokens: number;
            estimatedOutputTokens: number;
            totalEstimatedTokens: number;
        };
    };
}

export interface ChatMessageResponse {
    success: boolean;
    message?: string;
    data: {
        conversationId: string;
        userMessageId: string;
        responses: Array<{
            messageId: string;
            modelId: string;
            modelName: string;
            content: string;
            tokensUsed: number;
            usage?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
            };
            creditsCharged: number;
            featureFlags?: Record<string, any>;
        }>;
        totalCreditsCharged: number;
        newBalance: number;
        status?: string;
        jobId?: string;
    };
}

// Model Types
export interface Model {
    id: string;
    name: string;
    description: string;
    provider: {
        id: string;
        name: string;
        displayName: string;
    };
    tier: string;
    creditCost: number;
    tokenBucket: number;
    maxContextWindow: number;
    capabilities: string[];
    accessible: boolean;
    isActive: boolean;
    requiredPlan?: string;
}

export interface ModelsResponse {
    success: boolean;
    data: {
        models: Model[];
        count: number;
    };
}

// Conversation Types
export interface Conversation {
    id: string;
    userId: string;
    title: string;
    isArchived: boolean;
    isPinned?: boolean;
    createdAt: string;
    updatedAt: string;
    messages?: Message[];
    agentRuns?: AgentRun[];
    canvasArtifacts?: CanvasArtifact[];
}

export interface AgentRun {
    id: string;
    conversationId: string;
    messageId?: string;
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    createdAt: string;
    finishedAt?: string;
    error?: string;
}

export interface Message {
    id: string;
    conversationId: string;
    role: 'USER' | 'ASSISTANT' | 'SYSTEM';
    content: string;
    modelId?: string;
    createdAt: string;
    attachedDocumentIds?: string[];
    featureFlags?: Record<string, any>;
    totalTokens?: number;
    metadata?: {
        artifactId?: string;
        [key: string]: unknown;
    };
}

export interface Document {
    id: string;
    conversationId?: string;
    userId: string;
    originalFileName: string;
    storedFileName: string;
    filePath: string;
    mimeType: string;
    fileSize: number;
    processingStatus: string;
    metadata?: any;
    createdAt: string;
    updatedAt: string;
}

export interface CanvasArtifact {
    id: string;
    conversationId: string;
    userId: string;
    title: string;
    content: string;
    type: 'code' | 'document' | 'report' | 'markdown' | 'project' | 'render';
    language?: string;
    status: 'GENERATING' | 'COMPLETED' | 'FAILED';
    version: number;
    createdAt: string;
    updatedAt: string;
}

export interface CanvasArtifactResponse {
    success: boolean;
    data: CanvasArtifact;
}

export interface CanvasArtifactListResponse {
    success: boolean;
    data: CanvasArtifact[];
}

export interface CanvasGenerateResponse {
    success: boolean;
    data: {
        artifactId: string;
        jobId: string;
        status: string;
    };
}

export interface ConversationListResponse {
    success: boolean;
    data: {
        conversations: Conversation[];
        pagination: Pagination;
    };
}

export interface ConversationDetailResponse {
    success: boolean;
    data: Conversation & { conversation?: Conversation }; // Handles both wrapped and unwrapped
}

// Shared Types
export interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}
export type AuthModalScreen =
    | 'signin-email'
    | 'signin-password'
    | 'register'
    | 'email-verify-sent'
    | 'verify-email'
    | 'phone-number'
    | 'otp-verify'
    | 'forgot-password'
    | 'forgot-password-link-sent'
    | 'reset-password';

// Auth Context Type
export interface AuthContextType {
    user: User | null;
    /** Logged in (may still need email verification). */
    isAuthenticated: boolean;
    /** `true` when session exists but `email_verified_at` is missing — app routes should gate. */
    needsEmailVerification: boolean;
    isLoading: boolean;
    error: string | null;
    login: (credentials: LoginRequest) => Promise<void>;
    register: (credentials: RegisterRequest) => Promise<void>;
    loginWithGoogle: (credential: string) => Promise<void>;
    logout: () => Promise<void>;
    /** Revoke all refresh tokens server-side and clear local session. */
    logoutAll: () => Promise<void>;
    refreshUser: () => Promise<void>;
    /** Resend verification email (authenticated). */
    requestEmailVerification: () => Promise<void>;
    sendOtp: (phone: string) => Promise<any>;
    verifyOtp: (phone: string, otp: string) => Promise<void>;
    clearError: () => void;
    /** PATCH `/auth/me` when profile fields are provided; otherwise local merge only. */
    updateUser: (data: Partial<User> | UserUpdate) => Promise<void>;
    /** Change password; applies returned token bundle (other sessions revoked). */
    changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
    baseUrl: string;
    isAuthModalOpen: boolean;
    authModalScreen: AuthModalScreen;
    openAuthModal: (screen?: AuthModalScreen) => void;
    closeAuthModal: () => void;
    getAccessToken?: () => string | null;
    /** After password reset / flows that return access + refresh tokens (+ optional user). */
    applySessionFromTokenBundle: (bundle: {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        user?: unknown;
    }) => Promise<void>;
}

// Stream Types
export type StreamEventType = "chunk" | "done" | "error" | "status";

export type StreamStatusPhase =
    | "started"
    | "web_search_deciding"
    | "web_search_searching"
    | "web_search_ready"
    | "web_search_failed"
    | "documents_processing"
    | "documents_ready"
    | "credits_reserved"
    | "generating";

export interface StreamChunkEvent {
    event: "chunk";
    data: {
        content: string;
        modelId: string;
    };
}

export interface StreamStatusEvent {
    event: "status";
    data: {
        phase: StreamStatusPhase;
        message: string;
        searchQuery?: string;
    };
}

export interface StreamDoneEvent {
    event: "done";
    data: {
        conversationId: string;
        userMessageId: string;
        responses: Array<{
            messageId: string;
            modelId: string;
            modelName: string;
            content: string;
            tokensUsed: number;
            usage?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
            };
            creditsCharged: number;
            featureFlags?: Record<string, any>;
        }>;
        totalCreditsCharged: number;
        newBalance: number;
        usage?: any;
        finishReason?: string;
    };
}

export interface StreamErrorEvent {
    event: "error";
    data: {
        error: string;
        code?: string;
    };
}

export type StreamEvent =
    | StreamChunkEvent
    | StreamStatusEvent
    | StreamDoneEvent
    | StreamErrorEvent;
