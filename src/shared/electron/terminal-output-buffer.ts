// The reconnect window has the same character boundary as the previous manager buffer.
// Appending does not materialize or copy the complete window.
export class TerminalOutputBuffer {
  private chunks: string[] = [];
  private head = 0;
  private characterCount = 0;
  private materialized: string | undefined;

  constructor(private readonly capacity: number) {}

  get length(): number {
    return this.characterCount;
  }

  append(chunk: string): void {
    if (!chunk) {
      return;
    }
    this.materialized = undefined;
    if (chunk.length >= this.capacity) {
      const tail = chunk.slice(-this.capacity);
      // Detach a small suffix from an unusually large V8 sliced string. UTF-16 preserves
      // split surrogate pairs exactly, unlike a UTF-8 round trip.
      this.chunks = [chunk.length > this.capacity * 2
        ? Buffer.from(tail, "utf16le").toString("utf16le")
        : tail];
      this.head = 0;
      this.characterCount = this.capacity;
      return;
    }
    this.chunks.push(chunk);
    this.characterCount += chunk.length;
    let excess = this.characterCount - this.capacity;
    while (excess > 0) {
      const first = this.chunks[this.head];
      if (first.length <= excess) {
        excess -= first.length;
        this.characterCount -= first.length;
        this.chunks[this.head] = "";
        this.head += 1;
      } else {
        this.chunks[this.head] = first.slice(excess);
        this.characterCount -= excess;
        excess = 0;
      }
    }
    if (this.head >= 64 && this.head * 2 >= this.chunks.length) {
      this.chunks = this.chunks.slice(this.head);
      this.head = 0;
    }
  }

  toString(): string {
    this.materialized ??= this.chunks.slice(this.head).join("");
    return this.materialized;
  }

  clear(): void {
    this.chunks = [];
    this.head = 0;
    this.characterCount = 0;
    this.materialized = undefined;
  }
}
