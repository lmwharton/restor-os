"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface VoiceNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomName: string;
  existingNotes?: string;
  onSave: (notes: string) => void;
}

const MOCK_TRANSCRIPT =
  "Lifted carpet and pad in master bedroom. Flood cut drywall two feet from floor. Applied antimicrobial treatment to all exposed surfaces. Subfloor still showing elevated moisture at center point.";

/**
 * Inner content — mounts fresh each time the modal opens,
 * so no need to manually reset state between opens.
 */
function VoiceNoteContent({
  onClose,
  roomName,
  existingNotes,
  onSave,
}: Omit<VoiceNoteModalProps, "isOpen">) {
  const [isListening, setIsListening] = useState(false);
  const [notes, setNotes] = useState(existingNotes ?? "");
  const [visible, setVisible] = useState(false);
  const transcriptIndexRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Enter animation
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Simulate transcription when listening
  useEffect(() => {
    if (isListening) {
      intervalRef.current = setInterval(() => {
        const idx = transcriptIndexRef.current;
        if (idx < MOCK_TRANSCRIPT.length) {
          const nextSpace = MOCK_TRANSCRIPT.indexOf(" ", idx + 1);
          const end = nextSpace === -1 ? MOCK_TRANSCRIPT.length : nextSpace + 1;
          const chunk = MOCK_TRANSCRIPT.slice(idx, end);
          transcriptIndexRef.current = end;
          setNotes((prev) => prev + chunk);
        } else {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setIsListening(false);
        }
      }, 120);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isListening]);

  const toggleListening = useCallback(() => {
    setIsListening((prev) => !prev);
  }, []);

  const handleSave = useCallback(() => {
    onSave(notes);
    onClose();
  }, [notes, onSave, onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/60 backdrop-blur-sm"
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 200ms ease-out",
      }}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={`Field notes for ${roomName}`}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-8 shadow-xl"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(8px)",
          transition: "opacity 200ms ease-out, transform 200ms ease-out",
        }}
      >
        {/* Room name */}
        <p className="text-[13px] text-on-surface-variant">{roomName}</p>
        {/* Title */}
        <h2 className="mt-1 text-xl font-semibold text-on-surface">
          Field Notes
        </h2>

        {/* Mic button */}
        <div className="mt-8 flex flex-col items-center">
          <div className="relative flex items-center justify-center">
            {/* Pulsing rings when listening */}
            {isListening && (
              <>
                <span className="absolute h-[80px] w-[80px] animate-[voicePulse1_2s_ease-out_infinite] rounded-full border-2 border-brand-accent/40" />
                <span className="absolute h-[80px] w-[80px] animate-[voicePulse2_2s_ease-out_0.4s_infinite] rounded-full border-2 border-brand-accent/25" />
                <span className="absolute h-[80px] w-[80px] animate-[voicePulse3_2s_ease-out_0.8s_infinite] rounded-full border-2 border-brand-accent/15" />
              </>
            )}
            <button
              type="button"
              onClick={toggleListening}
              className={`primary-gradient relative z-10 flex h-[80px] w-[80px] items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 ${isListening ? "animate-[micBreath_1.5s_ease-in-out_infinite]" : ""}`}
              aria-label={isListening ? "Stop listening" : "Start listening"}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  x="9"
                  y="2"
                  width="6"
                  height="12"
                  rx="3"
                  fill="white"
                />
                <path
                  d="M5 11a7 7 0 0 0 14 0"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <line
                  x1="12"
                  y1="18"
                  x2="12"
                  y2="22"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <line
                  x1="8"
                  y1="22"
                  x2="16"
                  y2="22"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <p
            className={`mt-4 text-sm font-medium ${isListening ? "text-brand-accent" : "text-on-surface-variant"}`}
          >
            {isListening ? "Listening..." : "Tap to start"}
          </p>
        </div>

        {/* Transcription area */}
        <div className="mt-6 rounded-xl bg-surface-container p-4">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Your voice notes will appear here, or type directly..."
            className="min-h-[120px] w-full resize-none bg-transparent text-sm leading-relaxed text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none"
            aria-label="Transcription text"
          />
        </div>

        {/* Hint */}
        <p className="mt-3 text-[12px] italic text-on-surface-variant/70">
          These notes feed into your scope &mdash; be specific
        </p>

        {/* Action buttons */}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-12 flex-1 rounded-xl bg-surface-container text-sm font-medium text-on-surface transition-colors hover:bg-surface-container-high active:bg-surface-container-highest"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="primary-gradient h-12 flex-1 rounded-xl text-sm font-medium text-on-primary transition-opacity hover:opacity-90 active:opacity-80"
          >
            Save Note &#10003;
          </button>
        </div>
      </div>

      {/* Keyframe animations */}
      <style>{`
        @keyframes voicePulse1 {
          0% { transform: scale(1); opacity: 0.5; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        @keyframes voicePulse2 {
          0% { transform: scale(1); opacity: 0.4; }
          100% { transform: scale(2.0); opacity: 0; }
        }
        @keyframes voicePulse3 {
          0% { transform: scale(1); opacity: 0.3; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes micBreath {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
      `}</style>
    </div>
  );
}

/**
 * VoiceNoteModal — conditionally mounts VoiceNoteContent when open.
 * Remounting resets all internal state cleanly.
 */
export default function VoiceNoteModal({ isOpen, ...rest }: VoiceNoteModalProps) {
  if (!isOpen) return null;
  return <VoiceNoteContent {...rest} />;
}
