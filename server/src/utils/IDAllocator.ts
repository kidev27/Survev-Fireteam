/**
 * Class to manage entity ID's
 */
export class IDAllocator {
    readonly maxId: number;
    private _currentId = 1;
    /**
     * A list of free ID's to be used once the main ID's run out
     */
    private readonly _freeList: number[] = [];
    private readonly _inUse = new Set<number>();
    private readonly _reserved = new Set<number>();

    constructor(maxId: number, reserved: number[] = []) {
        this.maxId = maxId;
        for (let i = 0; i < reserved.length; i++) {
            const id = reserved[i];
            if (id > 0 && id <= maxId) this._reserved.add(id);
        }
    }

    /**
     * Gets the next available ID.
     * Prefers the free list, then the bump allocator, then any unused slot.
     * Never throws while at least one id in [1, maxId] is free.
     */
    getNextId(): number {
        while (this._freeList.length) {
            const id = this._freeList.shift()!;
            if (this._reserved.has(id) || this._inUse.has(id)) continue;
            this._inUse.add(id);
            return id;
        }

        while (this._currentId <= this.maxId) {
            const id = this._currentId++;
            if (this._reserved.has(id) || this._inUse.has(id)) continue;
            this._inUse.add(id);
            return id;
        }

        for (let id = 1; id <= this.maxId; id++) {
            if (this._reserved.has(id) || this._inUse.has(id)) continue;
            this._inUse.add(id);
            return id;
        }

        throw new Error("Ran out of ID's");
    }

    /**
     * Gives an ID back to the allocator so it can be reused once it runs out of ID's
     * NOTE: This doesn't check if the ID is already on the free list
     */
    give(id: number) {
        if (id <= 0 || id > this.maxId || this._reserved.has(id)) return;
        this._inUse.delete(id);
        this._freeList.push(id);
    }
}
