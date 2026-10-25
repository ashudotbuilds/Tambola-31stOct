export type MarkSaveStatus = 'saved' | 'saving' | 'offline' | 'retrying'

/** Coalesce taps, serialize writes, and keep the latest snapshot after a failure. */
export class MarkSaver {
  private revision = 0
  private confirmed = 0
  private marked: number[] = []
  private flight: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private retryMs = 1000
  private disposed = false
  constructor(private options: {
    send: (marked: number[]) => Promise<unknown>
    online: () => boolean
    status: (status: MarkSaveStatus) => void
    saved: (marked: number[]) => void
  }) {}

  update(marked: number[]) {
    this.marked = [...marked]; this.revision++
    this.options.status(this.options.online() ? 'saving' : 'offline')
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush().catch(() => {}) }, 180)
  }

  flush(): Promise<void> {
    clearTimeout(this.timer)
    if (this.disposed || this.confirmed === this.revision) return Promise.resolve()
    if (this.flight) return this.flight
    if (!this.options.online()) {
      this.options.status('offline')
      return Promise.reject(new Error('Your marks are waiting for a connection'))
    }
    this.options.status('saving')
    this.flight = (async () => {
      while (!this.disposed && this.confirmed < this.revision) {
        const revision = this.revision, snapshot = [...this.marked]
        await this.options.send(snapshot)
        this.confirmed = revision
        this.options.saved(snapshot)
      }
      this.retryMs = 1000
      if (!this.disposed) this.options.status('saved')
    })().catch(error => {
      if (!this.disposed) {
        this.options.status(this.options.online() ? 'retrying' : 'offline')
        this.timer = setTimeout(() => { void this.flush().catch(() => {}) }, this.retryMs)
        this.retryMs = Math.min(this.retryMs * 2, 15_000)
      }
      throw error
    }).finally(() => { this.flight = null })
    return this.flight
  }

  dispose() { this.disposed = true; clearTimeout(this.timer) }
}
