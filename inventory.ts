// map of index to count
type SlotCounts = LuaMap<number, number>;

export class Inventory {
    _peripheral: InventoryPeripheral;
    _list: { [index: number]: SlotDetail };
    type: StorageType;
    _size: number;
    maxSlotCapacity: number;
    // map of (item name) to (map of (slot index) to (item count))
    slots: LuaMap<string, SlotCounts>;
    name: string;

    constructor(peripheralName: string, type: StorageType, size?: number) {
        this._peripheral = peripheral.wrap(peripheralName) as InventoryPeripheral;
        this.type = type;
        this.name = peripheralName;
        this._size = size ?? this._peripheral.size();
        this.maxSlotCapacity = this._peripheral.getItemLimit(1);
        this.regenerateData();
    }
    getItemCount(name: string) {
        if (this.type === StorageType.Input) return 0;
        let total = 0;
        const slots = this.slots.get(name);
        if (slots === undefined) return 0;
        for (const [, count] of slots)
            total += count;
        return total;
    }
    *getNextAvailableSlot(name: string): Generator<number, void, undefined> {
        // check all slots of item - if none work, return empty slot
        const slotCounts = this.slots.get(name);
        if (slotCounts !== undefined)
            for (const [slot, count] of slotCounts)
                if (count < this.maxSlotCapacity)
                    yield slot;
        // return slot if empty, inventories are 1-indexed
        for (const i of $range(1, this.size()))
            if (this.getSlot(i) === undefined) {
                yield i;
                for (const value of this.getNextAvailableSlot(name)) yield value;
            }
        // DEBUG && print(`${peripheral.getName(this._peripheral)} is too full for ${name}`);
        return;
    }
    recieveItems(name: string, slot: number, count: number) {
        // update this.slots
        let currentSlots = this.slots.get(name);
        if (currentSlots === undefined) {
            currentSlots = new LuaMap();
            this.slots.set(name, currentSlots);
        }
        const newAmount = (currentSlots.get(slot) ?? 0) + count;
        // if (currentAmount + count > this.getItemLimit(slot)) DEBUG && print("issue - recieveItems called with excessive value");
        currentSlots.set(slot, newAmount);
        // update this._list
        if (this._list[slot] === undefined) {
            const slotDetail: SlotDetail = { name, count };
            this._list[slot] = slotDetail;
        } else {
            // if (this._list[slot].name !== name) DEBUG && print("issue - recieveItems called with wrong name");
            this._list[slot].count = newAmount;
        }
    }
    regenerateData() {
        this.slots = new LuaMap();
        this._list = this._peripheral.list();
        for (const [slot, item] of pairs(this._list)) {
            let currentSlots = this.slots.get(item.name);
            if (currentSlots === undefined) {
                currentSlots = new LuaMap();
                this.slots.set(item.name, currentSlots);
            }
            currentSlots.set(slot, item.count);
        }
    }
    // wrappers for peripheral
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
        if (this.type === StorageType.Input) {
            print("Error: attempting to push items from an input storage");
            return;
        }
        const itemToMove = this._list[fromSlot];
        limit = limit ?? (itemToMove.count ?? 0);
        let totalMoved = 0;
        const slotGenerator = to.getNextAvailableSlot(itemToMove.name);
        // TODO: rewrite to use parallels API
        let moveQueue: (() => void)[] = [];
        while (totalMoved < limit && itemToMove.count !== undefined) {
            const nextSlot = slotGenerator.next();
            if (nextSlot.done) return totalMoved;
            // will never be void due to above check
            const toSlot = nextSlot.value as number;
            const fromSlotItem = this.getSlot(fromSlot);
            const toSlotItem = to.getSlot(toSlot) ?? { count: 0 };
            const amountMoved = fromSlotItem.count - (math.max(0, toSlotItem.count + fromSlotItem.count - to.maxSlotCapacity));
            // declare as a separate variable - totalMoved will be changed, and that change is carried through to moveQueue
            // such that totalMoved >= limit when it is called - separate variable remains unchanged, allows call to work as intended
            const amountInCurrentMove = limit - totalMoved;
            moveQueue.push(() => this._peripheral.pushItems(to.name, fromSlot, amountInCurrentMove, toSlot));
            totalMoved += amountMoved;
            // sync stored data in src
            // setting value to 'undefined' is the same as removing it
            let newSlotCount: number;
            if (itemToMove.count !== amountMoved) newSlotCount = itemToMove.count - amountMoved;
            this.slots.get(itemToMove.name).set(fromSlot, newSlotCount);
            itemToMove.count = newSlotCount;
            // sync stored data in dest
            to.recieveItems(itemToMove.name, toSlot, amountMoved);
            if (moveQueue.length >= 224) {
                parallel.waitForAll(...moveQueue);
                moveQueue = [];
            }
        }
        parallel.waitForAll(...moveQueue);
        return totalMoved;
    }
    pullItems(from: Inventory, fromSlot: number, limit?: number) {
        from.pushItems(this, fromSlot, limit);
    }
}