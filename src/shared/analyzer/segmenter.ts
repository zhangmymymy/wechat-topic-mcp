import type { Message } from "../types.js";

const GAP_THRESHOLD_MS = 5 * 60 * 1000;

export function segmentMessages(messages: Message[], maxPerSegment: number = 150): Message[][] {
  if (messages.length === 0) return [];
  if (messages.length <= maxPerSegment && !hasLargeGap(messages)) {
    return [messages];
  }

  const segments: Message[][] = [];
  let current: Message[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const prevTime = new Date(messages[i - 1].timestamp).getTime();
    const currTime = new Date(messages[i].timestamp).getTime();
    const gap = currTime - prevTime;

    if (gap > GAP_THRESHOLD_MS || current.length >= maxPerSegment) {
      segments.push(current);
      current = [messages[i]];
    } else {
      current.push(messages[i]);
    }
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

function hasLargeGap(messages: Message[]): boolean {
  for (let i = 1; i < messages.length; i++) {
    const gap = new Date(messages[i].timestamp).getTime() - new Date(messages[i - 1].timestamp).getTime();
    if (gap > GAP_THRESHOLD_MS) return true;
  }
  return false;
}
