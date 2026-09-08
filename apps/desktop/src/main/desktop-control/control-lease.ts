// Shared by Windows Browser and Desktop. The lease protects both observations and
// input; a screenshot taken while a different task changes the desktop is stale.
export class DesktopControlLease {
  #owner: string | null = null;
  #epoch = 0;
  acquire(owner: string): { epoch: number; release(): void } {
    if (this.#owner !== null) throw new Error("DESKTOP_CONTROL_BUSY");
    this.#owner = owner;
    const epoch = ++this.#epoch;
    return {
      epoch,
      release: () => {
        if (this.#epoch === epoch) this.#owner = null;
      },
    };
  }
  assert(owner: string, epoch: number): void {
    if (this.#owner !== owner || this.#epoch !== epoch)
      throw new Error("DESKTOP_CONTROL_LEASE_LOST");
  }
}
