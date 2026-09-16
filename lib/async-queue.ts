/**
 * A single-consumer async queue.
 *
 * The orchestrator needs producers (sources running concurrently) to hand
 * events to one consumer (the SSE stream) the instant they are produced. Without
 * this, the username sweep — the longest-running source by far — would buffer
 * every result until it finished, and the live progress counter the report
 * depends on would never move.
 */
export class AsyncQueue<T> {
  private readonly items: T[] = [];
  private closed = false;
  private wake: (() => void) | null = null;

  push(item: T): void {
    if (this.closed) return;
    this.items.push(item);
    this.wake?.();
    this.wake = null;
  }

  close(): void {
    this.closed = true;
    this.wake?.();
    this.wake = null;
  }

  async *drain(): AsyncGenerator<T> {
    for (;;) {
      while (this.items.length > 0) {
        yield this.items.shift()!;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}
