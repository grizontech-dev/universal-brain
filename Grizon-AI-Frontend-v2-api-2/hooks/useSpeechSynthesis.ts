'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseSpeechSynthesisOptions {
    onEnd?: () => void;
    speaker?: string;
}

function detectLanguage(text: string): string {
    const scriptPatterns: Record<string, RegExp> = {
        'hi-IN': /[\u0900-\u097F]/,
        'bn-IN': /[\u0980-\u09FF]/,
        'pa-IN': /[\u0A00-\u0A7F]/,
        'gu-IN': /[\u0A80-\u0AFF]/,
        'ta-IN': /[\u0B80-\u0BFF]/,
        'te-IN': /[\u0C00-\u0C7F]/,
        'kn-IN': /[\u0C80-\u0CFF]/,
        'ml-IN': /[\u0D00-\u0D7F]/,
    };

    for (const [lang, pattern] of Object.entries(scriptPatterns)) {
        if (pattern.test(text)) return lang;
    }

    return 'en-US';
}

export const useSpeechSynthesis = (options: UseSpeechSynthesisOptions = {}) => {
    const { onEnd } = options;
    const [isSpeaking, setIsSpeaking] = useState(false);
    const queueRef = useRef<string[]>([]);
    const isPlayingRef = useRef(false);
    const onEndRef = useRef(onEnd);

    useEffect(() => {
        onEndRef.current = onEnd;
    }, [onEnd]);

    const playNextInQueue = useCallback(async () => {
        if (queueRef.current.length === 0) {
            isPlayingRef.current = false;
            setIsSpeaking(false);
            if (onEndRef.current) onEndRef.current();
            return;
        }

        const text = queueRef.current.shift();
        if (!text) {
            playNextInQueue();
            return;
        }

        if (typeof window === 'undefined' || !window.speechSynthesis) {
            playNextInQueue();
            return;
        }

        await new Promise<void>((resolve) => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = detectLanguage(text);
            utterance.onend = () => resolve();
            utterance.onerror = () => resolve();
            window.speechSynthesis.speak(utterance);
        });

        playNextInQueue();
    }, []);

    const speak = useCallback(
        async (text: string, append = false) => {
            if (!text) return;

            if (!append) {
                if (typeof window !== 'undefined' && window.speechSynthesis) {
                    window.speechSynthesis.cancel();
                }
                queueRef.current = [text];
            } else {
                queueRef.current.push(text);
            }

            setIsSpeaking(true);
            if (!isPlayingRef.current) {
                isPlayingRef.current = true;
                playNextInQueue();
            }
        },
        [playNextInQueue]
    );

    const stopSpeaking = useCallback(() => {
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        queueRef.current = [];
        isPlayingRef.current = false;
        setIsSpeaking(false);
    }, []);

    return { isSpeaking, speak, stopSpeaking };
};
