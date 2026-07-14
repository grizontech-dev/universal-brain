import { getConversation, listConversations, createConversation, patchConversation, deleteConversation } from './chat-rest-api';
import { brainApiFetch } from '@/brain/lib/brainApiBase';

export const brainApi = {
    createConversation: async (data: { user_id: string; content: string; repo_url?: string }): Promise<any> => {
        const response = await brainApiFetch('conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!response || !response.ok) {
            if (!response) throw new Error('Brain conversation creation failed: no response (network error or timeout)');
            throw new Error(`Brain conversation creation failed: ${response.status}`);
        }
        return await response.json();
    },
    getConversation: async (id: string): Promise<any> => {
        const response = await brainApiFetch(`conversations/${id}`);
        if (!response || !response.ok) {
            if (!response) throw new Error('Brain conversation fetch failed: no response');
            throw new Error(`Brain conversation fetch failed: ${response.status}`);
        }
        return await response.json();
    },
    listConversations: async (userId?: string): Promise<any> => {
        const params = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
        const response = await brainApiFetch(`conversations${params}`);
        if (!response || !response.ok) {
            if (!response) throw new Error('Brain conversations list failed: no response');
            throw new Error(`Brain conversations list failed: ${response.status}`);
        }
        return await response.json();
    },
    streamChat: async (data: { 
        user_id: string; 
        conversation_id?: string; 
        content: string; 
        repo_url?: string; 
        model_id?: string; 
        plan_approved?: boolean;
        approved_plan?: string;
        temperature?: number;
        framework?: string;
        question_rounds?: number;
        resume_build?: boolean;
        project_id?: string;
    }, onChunk: (chunk: any) => void, signal?: AbortSignal, retries = 2) => {
        const attemptStream = async (attempt: number): Promise<void> => {
            const response = await brainApiFetch('chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
                body: JSON.stringify(data),
                signal,
            });

            if (!response || !response.ok) {
                if (!response) {
                    throw new Error('Brain stream initiation failed: no response (network error or backend unreachable)');
                }
                let errorMessage = `Brain stream initiation failed: ${response.status}`;
                try {
                    const error = await response.json();
                    if (error?.error) errorMessage = `Brain stream initiation failed: ${error.error} (${response.status})`;
                } catch {
                    try {
                        const text = await response.text();
                        if (text) errorMessage = `Brain stream initiation failed: ${text.slice(0, 200)} (${response.status})`;
                    } catch {}
                }
                throw new Error(errorMessage);
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error('Browser does not support stream reading');

            const decoder = new TextDecoder();
            let buffer = '';

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine) continue;

                        if (trimmedLine.startsWith('data: ')) {
                            try {
                                const json = JSON.parse(trimmedLine.slice(6));
                                onChunk(json);
                            } catch (e) {
                                console.warn('Error parsing brain stream data:', trimmedLine, e);
                            }
                        }
                    }
                }
            } catch (e: any) {
                const isAbort = e?.name === 'AbortError';
                const isNetwork = e?.message?.includes('socket hang up') || 
                                   e?.message?.includes('ECONNRESET') || 
                                   e?.message?.includes('NetworkError') ||
                                   e?.message?.includes('fetch');
                if (isAbort) return;
                if (isNetwork && attempt < retries) {
                    const backoff = Math.min(1000 * Math.pow(2, attempt), 5000);
                    console.warn(`[brainApi] Stream interrupted (${e.message}), retrying in ${backoff}ms (attempt ${attempt + 1}/${retries + 1})`);
                    await new Promise(r => setTimeout(r, backoff));
                    return attemptStream(attempt + 1);
                }
                throw e;
            } finally {
                reader.releaseLock();
            }
        };

        await attemptStream(0);
    },
    stopChat: async (conversationId: string): Promise<any> => {
        const response = await brainApiFetch(`chat/stop?conversation_id=${conversationId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!response || !response.ok) {
            if (!response) throw new Error('Brain stop request failed: no response (network error or timeout)');
            throw new Error(`Brain stop request failed: ${response.status}`);
        }
        return await response.json();
    }
};

export const conversationsApi = {
    get: async (id: string): Promise<any> => {
        // Try Brain backend first (Brain conversations live in Brain's DB)
        try {
            const brainRes = await brainApi.getConversation(id);
            if (brainRes && brainRes.conversation) {
                return {
                    success: true,
                    data: {
                        conversation: {
                            ...brainRes.conversation,
                            messages: brainRes.messages
                        },
                        messages: brainRes.messages
                    }
                };
            }
        } catch {
            // Fall through to main backend for non-Brain conversations
        }
        // Fallback: main backend (standard chat conversations)
        const res = await getConversation(id);
        return {
            success: true,
            data: {
                conversation: {
                    ...res.conversation,
                    messages: res.messages
                },
                messages: res.messages
            }
        };
    },
    list: async (): Promise<any> => {
        // Try Brain backend first for Brain conversations
        try {
            const brainRes = await brainApi.listConversations();
            if (Array.isArray(brainRes) && brainRes.length > 0) {
                return { success: true, data: { items: brainRes } };
            }
        } catch {
            // Fall through to main backend
        }
        // Fallback: main backend
        const res = await listConversations();
        return { success: true, data: { items: res } };
    },
    create: async (data: any): Promise<any> => {
        const res = await createConversation(data);
        return { success: true, data: res.conversation };
    },
    update: async (id: string, data: any) => {
        const res = await patchConversation(id, data);
        return { success: true, data: res.conversation };
    },
    delete: async (id: string) => {
        await deleteConversation(id);
        return { success: true };
    }
};