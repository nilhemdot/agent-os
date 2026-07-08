"use client";

// HermesPet — a petdex sprite (boba the otter) that mirrors the agent's live
// state, the way Hermes shows it natively in the CLI/TUI/desktop. Each state is a
// pre-cropped frame from the petdex spritesheet; the pet swaps pose by activity
// (idle / thinking / done / failed / waiting) with a gentle idle bob.
import { useEffect, useRef, useState } from "react";

export type PetState = "idle" | "running" | "waving" | "failed" | "waiting";

export default function HermesPet({
  state = "idle",
  dir = "/pets/boba",
  height = 104,
  title = "Boba — your Hermes pet",
}: {
  state?: PetState;
  dir?: string;
  height?: number;
  title?: string;
}) {
  return (
    <img
      src={`${dir}/${state}.png`}
      alt={`Hermes pet: ${state}`}
      title={title}
      draggable={false}
      className="hermes-pet"
      style={{ height: `${height}px`, width: "auto" }}
    />
  );
}

// Derive a pet state from the chat's activity. Shows a brief celebratory wave
// right after a reply lands, then settles back to idle.
export function usePetState(streaming: boolean, errored = false): PetState {
  const [wave, setWave] = useState(false);
  const prev = useRef(streaming);
  useEffect(() => {
    if (prev.current && !streaming && !errored) {
      setWave(true);
      const t = setTimeout(() => setWave(false), 1800);
      prev.current = streaming;
      return () => clearTimeout(t);
    }
    prev.current = streaming;
  }, [streaming, errored]);
  if (errored) return "failed";
  if (streaming) return "running";
  if (wave) return "waving";
  return "idle";
}
