// map of index to count
type SlotCounts = LuaMap<number, number>;

/**
 * This class wraps an Inventory Peripheral, exposing a few extra methods.
 * All API calls that can be cached are performed during instantiation.
 * Instantiate in parallel wherever possible.
 */
export class Inventory {
    _peripheral: InventoryPeripheral;
    _list: { [index: number]: SlotDetail };
    _size: number;
    // map of (item name) to (map of (slot index) to (item count))
    _slots: LuaMap<string, SlotCounts>;
    _name: string;
    /**
     * A storage type is a number that can be used to filter chests, such as inputs or outputs.
     * It is used internally to prevent taking items from input chests.
    */
    type: StorageType;
    /**
     * This is the maximum amount of an item that can be stored in a single slot in the wrapped inventory.
     * - This is extrapolated from the first slot, and so issues may occur in storing unstackable items.
     * - It can be overridden during instantiation.
     */
    itemLimit: number;
    /**
     *
     * @param peripheralName The name passed to peripheral.wrap() to give an inventory peripheral.
     * @param type The type of storage that the {@link Inventory} can be filtered by.
     * @param itemLimit The maximum amount that an item can stack to in a single slot.
     */
    constructor(peripheralName: string, type: StorageType, itemLimit?: number) {
        this._peripheral = peripheral.wrap(peripheralName) as InventoryPeripheral;
        this.type = type;
        this._name = peripheralName;
        this._size = this._peripheral.size();
        this.itemLimit = itemLimit ?? this._peripheral.getItemLimit(1);
        this.syncData();
    }

    /**
     * This is the core data structure that makes the wrapper fast.
     * When searching for an item by name, the slots it is in, as well as the counts, are accessible in the map.
     * SlotCounts is a map of slot indexes to the count stored at that index.
     */
    getSlots(): LuaMap<string, SlotCounts> {
        return this._slots;
    }

    /**
     * @returns the amount stored of the given item
     */
    getItemCount(name: string): number {
        if (this.type === StorageType.Input) return 0;
        let total = 0;
        const slots = this._slots.get(name);
        if (slots === undefined) return 0;
        for (const [, count] of slots)
            total += count;
        return total;
    }

    /**
     * Returns the name of the peripheral the instance wraps.
     */
    getName(): string {
        return this._name;
    }

    /**
     * This generator yields slot indexes for the inventory at which the specified item can be inserted.
     * If it is `done`, there are no more available slots for the item to be inserted at.
     */
    * getNextAvailableSlot(name: string): Generator<number, void, undefined> {
        // check all slots of item - if none work, return empty slot
        const slotCounts = this._slots.get(name);
        if (slotCounts !== undefined)
            for (const [slot, count] of slotCounts)
                if (count < this.itemLimit)
                    yield slot;
        // return slot if empty, inventories are 1-indexed
        for (const i of $range(1, this.size())) if (this.getSlot(i) === undefined) {
            yield i;
            for (const value of this.getNextAvailableSlot(name)) yield value;
        }
        return;
    }

    /**
     * This function exists to keep the cache in sync with the real inventory.
     * Desynchronisation can be caused by inserting an item into the underlying inventory, in which case this should be called.
     * It is automatically handled when using the wrapper to push to another {@link Inventory}.
     */
    receiveItems(name: string, slot: number, count: number) {
        // update this.slots
        let currentSlots = this._slots.get(name);
        if (currentSlots === undefined) {
            currentSlots = new LuaMap();
            this._slots.set(name, currentSlots);
        }
        const newAmount = (currentSlots.get(slot) ?? 0) + count;
        // if (currentAmount + count > this.getItemLimit(slot)) DEBUG && print("issue - receiveItems called with excessive value");
        currentSlots.set(slot, newAmount);
        // update this._list
        if (this._list[slot] === undefined) {
            const slotDetail: SlotDetail = { name, count };
            this._list[slot] = slotDetail;
        } else {
            // if (this._list[slot].name !== name) DEBUG && print("issue - receiveItems called with wrong name");
            this._list[slot].count = newAmount;
        }
    }

    /**
     * This is to be called when the inventory accesses cannot be synchronised, such as a player inserting or removing items.
     * As it calls the underlying inventory peripheral API, it is not particularly fast - use it sparingly.
     * If the source and destination of a pushItems call are stale, it cannot guarantee success.
     * Therefore, a player-accessed storage must be synchronised before pushing or pulling items.
     */
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

    /**
     * @see {@link https://tweaked.cc/generic_peripheral/inventory.html#v:size|tweaked.cc#size}
     */
    size() {
        return this._size;
    }

    /**
     * @see {@link https://tweaked.cc/generic_peripheral/inventory.html#v:list|tweaked.cc#list}
     */
    list() {
        return this._list;
    }

    /**
     * Returns basic details about the item in the given slot - its name, count, and hashed NBT.
     */
    getSlot(slot: number) {
        return this._list[slot];
    }

    /**
     * @see {@link https://tweaked.cc/generic_peripheral/inventory.html#v:getItemDetail|tweaked.cc#getItemDetail}
     */
    getItemDetail(slot: number) {
        return this._peripheral.getItemDetail(slot);
    }

    /**
     * @see {@link https://tweaked.cc/generic_peripheral/inventory.html#v:getItemLimit|tweaked.cc#getItemLimit}
     */
    getItemLimit(slot: number) {
        return this._peripheral.getItemLimit(slot);
    }

    /**
     * This function will push items from the wrapped Inventory to the destination Inventory.
     * It follows the default CC API, without the ability to specify a destination slot;
     * the wrapper is for managing large storages, not fine control.
     * @see {@link https://tweaked.cc/generic_peripheral/inventory.html#v:pushItems|tweaked.cc#pushItems}
     */
    pushItems(to: Inventory, fromSlot: number, limit?: number) {
        if (this.type === StorageType.Input) {
            print("Error: attempting to push items from an input storage");
            return;
        }
        const itemToMove = this._list[fromSlot];
        limit = limit ?? (itemToMove.count ?? 0);
        let totalMoved = 0;
        const slotGenerator = to.getNextAvailableSlot(itemToMove.name);
        while (totalMoved < limit && itemToMove.count !== undefined) {
            const nextSlot = slotGenerator.next();
            if (nextSlot.done) return totalMoved;
            // will never be void due to above check
            const toSlot = nextSlot.value as number;
            const amountMoved = this._peripheral.pushItems(to.getName(), fromSlot, limit - totalMoved, toSlot);
            totalMoved += amountMoved;
            // sync stored data in src
            // setting value to 'undefined' is the same as removing it
            let newSlotCount: number;
            if (itemToMove.count !== amountMoved) newSlotCount = itemToMove.count - amountMoved;
            this._slots.get(itemToMove.name).set(fromSlot, newSlotCount);
            itemToMove.count = newSlotCount;
            // sync stored data in dest
            to.receiveItems(itemToMove.name, toSlot, amountMoved);
        }
        return totalMoved;
    }

    /**
     * Calls pushItems on `from`, with the to value as `this`.
     * @see {@link pushItems}
     */
    pullItems(from: Inventory, fromSlot: number, limit?: number) {
        return from.pushItems(this, fromSlot, limit);
    }
}