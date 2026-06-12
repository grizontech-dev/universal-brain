import { useState, useCallback, useRef } from 'react';
import { simulateStream } from './stream-simulator';

export function useStream() {
    const [streamedText, setStreamedText] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    const startStream = useCallback(async (fullText: string, onComplete?: () => void) => {
        // Cancel any ongoing stream
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        
        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        
        setStreamedText('');
        setIsStreaming(true);

        try {
            const generator = simulateStream(fullText);
            
            for await (const chunk of generator) {
                if (abortController.signal.aborted) {
                    break;
                }
                setStreamedText(prev => prev + chunk);
            }
        } catch (error) {
            console.error('Streaming error:', error);
        } finally {
            if (!abortController.signal.aborted) {
                setIsStreaming(false);
                onComplete?.();
            }
        }
    }, []);

    const stopStream = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            setIsStreaming(false);
        }
    }, []);

    const appendToStream = useCallback((chunk: string) => {
        setStreamedText(prev => prev + chunk);
    }, []);

    return {
        streamedText,
        isStreaming,
        startStream,
        stopStream,
        appendToStream,
    };
}
