export interface Inventory {
    /**
     * This is the maximum amount of an item that can be stored in a single slot in the wrapped inventory.
     * - This is extrapolated from the first slot, and so issues may occur in storing unstackable items.
     * - It can be overridden during instantiation.
     */
    itemLimit: number;

    /**
     *
     * @param peripheralName The name passed to peripheral.wrap() to give an inventory peripheral.
     * @param sType The type of storage that the {@link Inventory} can be filtered by.
     * @param itemLimit The maximum amount that an item can stack to in a single slot.
     */
    constructor(peripheralName: string, itemLimit?: number): void;

    /**
     * This is the core data structure that makes the wrapper fast.
     * When searching for an item by name, the slots it is in, as well as the counts, are accessible in the map.
     * SlotCounts is a map of slot indexes to the count stored at that index.
     * @returns A map of item names to SlotCounts
     */
    getSlots(): LuaMap<string, SlotCounts>;

    /**
     * @param name The item to get the count of.
     * @returns The amount stored of the given item.
     */
    getItemCount(name: string): number;

    /**
     * @returns The name of the peripheral that the instance wraps.
     */
    getName(): string;

    /**
     * This function returns a coroutine that yields slot indexes for the inventory at which the specified item can be inserted.
     * If it is dead, there are no more available slots for the item to be inserted at.
     * @param name The name of the item to find a slot for.
     * @returns A coroutine to find subsequent available slots.
     */
    getNextAvailableSlot(name: string): (this: void) => LuaMultiReturn<any[]>;

    /**
     * This function exists to keep the cache in sync with the real inventory.
     * Desynchronisation can be caused by inserting an item into the underlying inventory, in which case this should be called.
     * It is automatically handled when using the wrapper to push to another {@link Inventory}.
     * @param name The name of the item being recieved.
     * @param slot The slot it is inserted into.
     * @param count The amount being inserted.
     */
    receiveItems(name: string, slot: number, count: number): void;

    /**
     * This is to be called when the inventory accesses cannot be synchronised, such as a player inserting or removing items.
     * As it calls the underlying inventory peripheral API, it is not particularly fast - use it sparingly.
     * If the source and destination of a pushItems call are stale, it cannot guarantee success.
     * Therefore, a player-accessed storage must be synchronised before pushing or pulling items.
     */
    syncData(): void;

    /**
     * Gets the number of slots without items.
     * @returns The number of slots containing no items.
     */
    getFreeSlotCount(): number;

    /**
     * @see {@link https://tweaked.cc/generic_peripheral/inventory.html#v:size|tweaked.cc#size}
     */
    size(): number;

    /**
     * @see {@link https://tweaked.cc/generic_peripheral/inventory.html#v:list|tweaked.cc#list}
     */
    list(): { [index: number]: SlotDetail };

    /**
     * Returns basic details about the item in the given slot - its name, count, and hashed NBT.
     * @param slot The slot to query.
     */
    getSlot(slot: number): SlotDetail;

    /**
     * @see {@link https://tweaked.cc/generic_peripheral/inventory.html#v:getItemDetail|tweaked.cc#getItemDetail}
     */
    getItemDetail(slot: number): SlotDetail & {
        displayName: string;
        maxCount: number;
        damage?: number;
        maxDamage?: number;
        durability?: number;
        tags: string[];
        lore?: string[];
        enchantments?: {
            name: string;
            level: number;
            displayName: string;
        }[];
        unbreakable?: boolean;
    };

    /**
     * @see {@link https://tweaked.cc/generic_peripheral/inventory.html#v:getItemLimit|tweaked.cc#getItemLimit}
     */
    getItemLimit(slot: number): number;

    /**
     * This function will push items from the wrapped Inventory to the destination Inventory.
     * It follows the default CC API, without the ability to specify a destination slot;
     * the wrapper is for managing large storages, not fine control.
     * @see {@link https://tweaked.cc/generic_peripheral/inventory.html#v:pushItems|tweaked.cc#pushItems}
     * @param to The wrapped inventory to push items to.
     * @param fromSlot: The slot from which to move items.
     * @param limit The maximum amount of items to move.
     * @returns The amount of items actually moved.
     */
    pushItems(to: Inventory, fromSlot: number, limit?: number): number;

    /**
     * Calls pushItems on `from`, with the to value as `this`.
     * @see {@link pushItems}
     * @param from The inventory to pull from.
     * @param fromSlot The slot to pull items from.
     * @param limit The maximum amount of items to move.
     * @returns The actual amount of items moved.
     */
    pullItems(from: Inventory, fromSlot: number, limit?: number): number;
}

/**
 * This class wraps an Inventory Peripheral, exposing a few extra methods.
 * All API calls that can be cached are performed during instantiation.
 * Instantiate in parallel wherever possible.
 */
export class Inventory {
    // The wrapped peripheral.
    _peripheral: InventoryPeripheral;
    // The name of the wrapped peripheral.
    _name: string;
    // map of (item name) to (map of (slot index) to (item count))
    _slots: LuaMap<string, SlotCounts>;
    // A cache for _peripheral.list()
    _list: { [index: number]: SlotDetail };
    // The size of the wrapped peripheral.
    _size: number;

    itemLimit: number;

    constructor(peripheralName: string, itemLimit?: number) {
        this._peripheral = peripheral.wrap(peripheralName) as InventoryPeripheral;
        this._name = peripheralName;
        this._size = this._peripheral.size();
        this.itemLimit = itemLimit ?? this._peripheral.getItemLimit(1);
        this.syncData();
    }

    getSlots(): LuaMap<string, SlotCounts> {
        return this._slots;
    }

    getItemCount(name: string): number {
        let total = 0;
        const slots = this._slots.get(name);
        if (slots === undefined) return 0;
        for (const [, count] of slots)
            total += count;
        return total;
    }

    getName(): string {
        return this._name;
    }

    getNextAvailableSlot(name: string): (this: void) => LuaMultiReturn<any[]> {
        return coroutine.wrap(() => {
            // check all slots of item - if none work, return empty slot
            const slotCounts = this._slots.get(name);
            if (slotCounts !== undefined)
                for (const [slot, count] of slotCounts)
                    if (count < this.itemLimit)
                        coroutine.yield(slot);
            // return slot if empty, inventories are 1-indexed
            for (const i of $range(1, this.size())) if (this.getSlot(i) === undefined) {
                coroutine.yield(i);
                const delegated = this.getNextAvailableSlot(name);
                while (true) {
                    const [slot] = delegated();
                    if (slot === undefined) return;
                    coroutine.yield(slot);
                }
            }
        });
    }

    receiveItems(name: string, slot: number, count: number) {
        // update this.slots
        let currentSlots = this._slots.get(name);
        if (currentSlots === undefined) {
            currentSlots = new LuaMap();
            this._slots.set(name, currentSlots);
        }
        const newAmount = (currentSlots.get(slot) ?? 0) + count;
        currentSlots.set(slot, newAmount);
        // update this._list
        if (this._list[slot] === undefined) {
            const slotDetail: SlotDetail = { name, count };
            this._list[slot] = slotDetail;
        } else {
            this._list[slot].count = newAmount;
        }
    }

    syncData() {
        this._slots = new LuaMap();
        this._list = this._peripheral.list();
        for (const [slot, item] of pairs(this._list)) {
            let currentSlots = this._slots.get(item.name);
            if (currentSlots === undefined) {
                currentSlots = new LuaMap();
                this._slots.set(item.name, currentSlots);
            }
            currentSlots.set(slot, item.count);
        }
    }

    getFreeSlotCount() {
        let occupiedCount = 0;
        for (const [,] of pairs(this._list))
            occupiedCount = occupiedCount + 1;
        return this.size() - occupiedCount;
    }

    size() {
        return this._size;
    }

    list() {
        return this._list;
    }

    getSlot(slot: number) {
        return this._list[slot];
    }

    getItemDetail(slot: number) {
        return this._peripheral.getItemDetail(slot);
    }

    getItemLimit(slot: number) {
        return this._peripheral.getItemLimit(slot);
    }

    pushItems(to: Inventory, fromSlot: number, limit?: number) {
        const itemToMove = this._list[fromSlot];
        limit = limit ?? (itemToMove.count ?? 0);
        let totalMoved = 0;
        const slotGenerator = to.getNextAvailableSlot(itemToMove.name);
        while (totalMoved < limit && itemToMove.count !== undefined) {
            const [nextSlot] = slotGenerator();
            if (nextSlot === undefined) return totalMoved;
            const amountMoved = this._peripheral.pushItems(to.getName(), fromSlot, limit - totalMoved, nextSlot);
            totalMoved += amountMoved;
            // sync stored data in src
            // setting value to 'undefined' is the same as removing it
            let newSlotCount: number;
            if (itemToMove.count !== amountMoved) newSlotCount = itemToMove.count - amountMoved;
            this._slots.get(itemToMove.name).set(fromSlot, newSlotCount);
            itemToMove.count = newSlotCount;
            // sync stored data in dest
            to.receiveItems(itemToMove.name, nextSlot, amountMoved);
        }
        return totalMoved;
    }

    pullItems(from: Inventory, fromSlot: number, limit?: number) {
        return from.pushItems(this, fromSlot, limit);
    }
}