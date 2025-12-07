"use client";

import { useState, useEffect, useCallback } from "react";

interface UseCountdownReturn {
  canResend: boolean;
  label: string;
  start: () => void;
  reset: () => void;
}

export const useCountdown = (
  initialSeconds: number,
  autoStart: boolean = false
): UseCountdownReturn => {
  const [seconds, setSeconds] = useState(initialSeconds);
  const [isActive, setIsActive] = useState(autoStart);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (isActive && seconds > 0) {
      interval = setInterval(() => {
        setSeconds((prev) => {
          if (prev <= 1) {
            setIsActive(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isActive, seconds]);

  const start = useCallback(() => {
    setSeconds(initialSeconds);
    setIsActive(true);
  }, [initialSeconds]);

  const reset = useCallback(() => {
    setSeconds(initialSeconds);
    setIsActive(false);
  }, [initialSeconds]);

  const formatTime = (totalSeconds: number): string => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const canResend = seconds === 0;
  const label = canResend ? "Resend code" : `Resend code in ${formatTime(seconds)}`;

  return {
    canResend,
    label,
    start,
    reset,
  };
};

