/** Keeps the head and the tail of long output, with a marker in the middle. */
export function truncateMiddle(text: string, max = 30_000): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const half = Math.floor(max / 2);
  const dropped = text.length - max;
  return { text: `${text.slice(0, half)}\n…[truncated ${dropped} characters]…\n${text.slice(text.length - half)}`, truncated: true };
}

/** Streaming collector that never holds more than ~max characters (head + tail ring). */
export class OutputBuffer {
  private head = '';
  private tail = '';
  private total = 0;
  constructor(private readonly max = 30_000) {}

  push(chunk: string) {
    this.total += chunk.length;
    const half = Math.floor(this.max / 2);
    if (this.head.length < half) {
      const room = half - this.head.length;
      this.head += chunk.slice(0, room);
      chunk = chunk.slice(room);
    }
    if (chunk) this.tail = (this.tail + chunk).slice(-half);
  }

  get length() {
    return this.total;
  }

  toString(): string {
    if (this.total <= this.max) return this.head + this.tail;
    const dropped = this.total - this.head.length - this.tail.length;
    return `${this.head}\n…[truncated ${dropped} characters]…\n${this.tail}`;
  }

  get truncated() {
    return this.total > this.max;
  }
}
