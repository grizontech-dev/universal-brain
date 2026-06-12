'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
interface UseSpeechRecognitionOptions {
  onResult?: (text: string, isFinal?: boolean) => void;
  onEnd?: (text?: string) => void;
  lang?: string;
  silenceThreshold?: number;
  silenceDuration?: number;
}

export const useSpeechRecognition = (options: UseSpeechRecognitionOptions = {}) => {
  const {
    onResult,
    onEnd,
    lang = 'hi-IN', // Default to Hindi-India for better real-time Indic support
    silenceThreshold = -45, // dB
    silenceDuration = 800 // ms - Faster path for real-time responsiveness
  } = options;

  const [isListening, setIsListening] = useState(false);
  const isListeningRef = useRef(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);

  // Audio Recording for Final Sarvam Transcription
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Browser Speech Recognition for Live Preview ("Sath Sath")
  const recognitionRef = useRef<any>(null);

  // Web Audio API for Silence Detection
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptRef = useRef('');

  const onResultRef = useRef(onResult);
  const onEndRef = useRef(onEnd);

  // Sync refs with latest options
  useEffect(() => {
    onResultRef.current = onResult;
    onEndRef.current = onEnd;
  }, [onResult, onEnd]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) { }
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (e) { }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    setIsListening(false);
    isListeningRef.current = false;
  }, []);

  // Initialize webkitSpeechRecognition if available
  useEffect(() => {
    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      const recognition = new SpeechRecognition();

      recognition.continuous = true;
      recognition.interimResults = true;

      // Dynamic language support: Try to use provided lang, fallback to browser, then to Hindi
      recognition.lang = lang;

      recognition.onresult = (event: any) => {
        let fullTranscript = '';
        for (let i = 0; i < event.results.length; ++i) {
          fullTranscript += event.results[i][0].transcript;
        }

        transcriptRef.current = fullTranscript;
        setTranscript(fullTranscript);

        if (onResultRef.current) {
          const isFinal = event.results[event.results.length - 1].isFinal;
          onResultRef.current(fullTranscript, isFinal);
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          console.error('Speech recognition error', event.error);
          if (event.error === 'network') {
            setError('Network error: Speech recognition connection lost.');
          }
        }
      };

      recognitionRef.current = recognition;
    }
  }, [lang]);

  const startListening = useCallback(async () => {
    cleanup();
    setTranscript('');
    setError(null);
    audioChunksRef.current = [];

    try {
      // 1. Get Stream with Noise Suppression
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      streamRef.current = stream;

      // 2. Setup Web Audio API for Silence Detection
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // 3. Setup MediaRecorder
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        void new Blob(audioChunksRef.current, { type: 'audio/wav' });
        /* UI-only: no server transcription */
      };

      // 4. Start Monitoring Volume
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const timeData = new Float32Array(analyser.fftSize);

      const checkVolume = () => {
        if (!analyserRef.current || !isListeningRef.current) return;

        analyserRef.current.getFloatTimeDomainData(timeData);
        
        // Calculate RMS Volume
        let sumSquares = 0;
        for (let i = 0; i < timeData.length; i++) {
          sumSquares += timeData[i] * timeData[i];
        }
        const rms = Math.sqrt(sumSquares / timeData.length);
        
        // Convert to dB (0 to -100 range typically)
        const volumeDB = rms > 0 ? 20 * Math.log10(rms) : -100;

        // Siri Threshold Tuning
        const currentThreshold = silenceThreshold;

        if (volumeDB > currentThreshold) {
          // User is speaking
          if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current);
            silenceTimeoutRef.current = null;
          }
        } else {
          // Silence detected
          if (!silenceTimeoutRef.current) {
            silenceTimeoutRef.current = setTimeout(() => {
              if (isListeningRef.current) {
                stopListening();
              }
            }, silenceDuration);
          }
        }

        // Normalize for UI visualizer (0.0 to 1.0)
        // dB usually ranges from -100 (silent) to 0 (loud)
        const normalizedVolume = Math.min(Math.max((volumeDB + 80) / 80, 0), 1);
        setVolume(normalizedVolume);

        if (isListeningRef.current) {
          requestAnimationFrame(checkVolume);
        }
      };

      // 5. Start Everything
      mediaRecorder.start();
      if (recognitionRef.current) {
        try { recognitionRef.current.start(); } catch (e) { }
      }
      setIsListening(true);
      isListeningRef.current = true;
      requestAnimationFrame(checkVolume);

    } catch (err: any) {
      console.error('Microphone Error:', err);
      setError('Could not access microphone');
      setIsListening(false);
      isListeningRef.current = false;
    }
  }, [cleanup, silenceThreshold, silenceDuration]);

  const stopListening = useCallback(() => {
    if (!isListeningRef.current) return;

    setIsListening(false);
    isListeningRef.current = false;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) { }
    }
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }

    // Call onEnd IMMEDIATELY for "Fast Path" behavior
    if (onEndRef.current) onEndRef.current(transcriptRef.current);
  }, []);

  return {
    isListening,
    transcript,
    error,
    startListening,
    stopListening,
    volume
  };
};


