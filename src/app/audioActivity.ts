type Context = Pick<AudioContext, 'state' | 'resume' | 'suspend' | 'close'>

export const isAudioActive = (documentHidden: boolean, xrVisibility: XRVisibilityState | null) =>
  xrVisibility === null ? !documentHidden : xrVisibility !== 'hidden'

/** Visibility is independent of the user's mute choice. Reconcile completed
 * requests because a delayed resume must not turn a hidden page back on. */
export class AudioActivity {
  private context: Context | null = null
  private active = true
  private disposed = false

  attach(context: Context) {
    if (this.disposed) { void context.close().catch(() => {}); return }
    this.context = context
    this.sync()
  }

  setActive(active: boolean) { this.active = active; this.sync() }

  sync() {
    const context = this.context, active = this.active
    if (!context || context.state === 'closed' || (active && context.state === 'running')) return
    // Even an already suspended context can have a resume request pending.
    // Submit the newer suspend without waiting behind that request.
    try {
      void (active ? context.resume() : context.suspend()).then(() => {
        if (this.context === context && this.active !== active) this.sync()
      }).catch(() => { /* A later user gesture can retry browser-blocked audio. */ })
    } catch { /* Some interrupted/closing platform contexts throw synchronously. */ }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    const context = this.context
    this.context = null
    if (context && context.state !== 'closed') void context.close().catch(() => {})
  }
}
