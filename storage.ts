import { Inventory } from "./inventory";

/**
 * Controller for groups of inventories, with utility methods to view them as a group.
 * Items can be moved between inventories using
 */
export interface Storage {
    /**
     * 
     * A map of peripheral names as used in {@link peripheral.wrap}, to instances of {@link Inventory}
     */
    _inventories: LuaMap<string, Inventory>;
    
    /**
     * Stores inventory peripheral names by their {@link StorageType}.
     * This allows for access by type, using {@link getStoragesByType}.
     */
    _storagesByType: { [index in StorageType]: LuaSet<string> };
    /**
     * Creates a Storage instance, initalising fields using {@link init}.
     * Requires storage type sets to allow for filtering.
     * Wraps all connected inventory peripherals using {@link Inventory}.
     */
    constructor(storagesByType: { [index in StorageType]: LuaSet<string> }): void;

    /**
     * Wraps all connected inventory peripherals using {@link Inventory}.
     * Alternatively, if peripherals is passed, it is used as the list of inventory peripherals to wrap.
     */
    init(peripherals?: LuaMultiReturn<IPeripheral[]>): void;

    /**
     * Iterates through each connected inventory, building a map of item name to total counts.
     * @returns A map of item names to their total counts.
     */
    getAllItems(): LuaMap<string, number>;

    /**
     * Gets the total amount of an item stored across all connected inventories by iterating through them.
     * @param item The name of the item to get the count of.
     * @returns The amount of that item that are stored.
     */
    getTotalItemCount(item: string): number;

    /**
     * Iterates through all connected inventories to collate all unique item names. Additional names can be inserted.
     * @param insertedValues Values to insert into the ordered item names, for autocompletion of craftable items.
     * @returns An ordered list of item names.
     */
    getItemNames(insertedValues?: string[]): string[];

    /**
     * Iterates through all connected inventories to collate all unique peripheral names.
     * @returns An ordered list of inventory peripheral names.
     */
    getInventoryNames(): string[];

    /**
     * Allows access to inventory peripherals by their designated type: Input, Storage, Output.
     * They can also be filted by NotInput, a union type of Storage and Output.
     * @param sType The storage type to filter by.
     * @returns A list of storages, all of the type filtered.
     */
    getStoragesByType(sType: StorageType): LuaSet<string>;

    /**
     * Access a single inventory peripheral by name, without wrapping it again.
     * If the inventory is not already wrapped, the instance will re-initalise to prevent issues when the chunks the system resides in are reloaded.
     * @param name The name of the inventory peripheral to wrap.
     * @returns The underlying peripheral.
     */
    getInventory(name: string): Inventory;

    /**
     * This function will move items from a single source to many destinations.
     * It will only move a single item, up to the given limit.
     * @param from The name of the source inventory peripheral.
     * @param to The name of the destination inventory peripherals.
     * @param name The name of the item to move.
     * @param limit The maximum amount of the item to move.
     * @returns Whether the limit was reached successfully.
     */
    moveItemFromOne(from: string, to: LuaSet<string> | [string], name: string, limit: number): boolean;

    /**
     * This function will move items from many sources to a single desination.
     * It will only move a single item, up to the given limit.
     * @param from The list of source inventory peripherals.
     * @param to The destination inventory peripheral.
     * @param name The name of the item to move.
     * @param limit The maximum amount of the item to move.
     * @returns The amount of items moved.
     */
    moveItemFromMany(from: LuaSet<string>, to: string, name: string, limit: number): number;

    /**
     * This function will move items from a single source to many desintations.
     * It will move every item from the source that can be moved into the destinations given.
     * @param from The source inventory to empty.
     * @param to A list of the destination inventories.
     */
    moveOneToMany(from: string, to: LuaSet<string>): void;
}

export class Storage implements Storage{
    _inventories: LuaMap<string, Inventory>;
    _storagesByType: { [index in StorageType]: LuaSet<string> };

    constructor(storagesByType: { [index in StorageType]: LuaSet<string> }, peripherals?: LuaMultiReturn<IPeripheral[]>) {
        this._storagesByType = storagesByType;
        this.init(peripherals);
    }

    init(peripherals?: LuaMultiReturn<IPeripheral[]>) {
        // get inventory data
        this._inventories = new LuaMap();
        peripherals = peripherals ?? peripheral.find("inventory");
        const newInvFuncs = [];
        for (const inv of peripherals) {
            const name = peripheral.getName(inv);
            newInvFuncs.push(() => {
                this._inventories.set(name, new Inventory(name));
            });
        }
        parallel.waitForAll(...newInvFuncs);
    }

    getAllItems(): LuaMap<string, number> {
        const itemMap = new LuaMap<string, number>();
        for (const [, inv] of this._inventories)
            for (const [name] of inv.getSlots()) {
                const newCount = (itemMap.get(name) ?? 0) + inv.getItemCount(name);
                itemMap.set(name, newCount);
            }
        return itemMap;
    }

    getTotalItemCount(item: string) {
        let total = 0;
        for (const name of this.getStoragesByType(StorageType.NotInput))
            total += this.getInventory(name).getItemCount(item);
        return total;
    }

    getItemNames(insertedValues?: string[]): string[] {
        const uniqueNames: string[] = [];
        if (insertedValues !== undefined) for (const value of insertedValues) uniqueNames.push(value);
        for (const [, inv] of this._inventories)
            for (const [name] of inv.getSlots())
                uniqueNames.push(name);
        return uniqueNames;
    }

    getInventoryNames(): string[] {
        const uniqueNames: string[] = [];
        for (const [name] of this._inventories)
            uniqueNames.push(name);
        return uniqueNames;
    }

    getStoragesByType(sType: StorageType) {
        return this._storagesByType[sType];
    }

    getInventory(name: string) {
        const maybeInventory = this._inventories.get(name);
        if (maybeInventory !== undefined) return maybeInventory;
        this.init();
        return this._inventories.get(name);
    }

    moveItemFromOne(from: string, to: LuaSet<string> | [string], name: string, limit: number): boolean {
        const srcInv = this.getInventory(from);
        const srcSlots = srcInv.getSlots().get(name);
        if (srcSlots === undefined) return false;
        for (const destStr of to) {
            const destInv = this.getInventory(destStr);
            for (const [fromSlot] of srcSlots) {
                limit -= srcInv.pushItems(destInv, fromSlot, limit);
                if (limit === 0) return true;
            }
        }
        return false;
    }

    moveItemFromMany(from: LuaSet<string>, to: string, name: string, limit: number): number {
        const destInv = this.getInventory(to);
        const startingLimit = limit;
        // for each source inventory
        for (const srcInvStr of from) {
            const srcInv = this.getInventory(srcInvStr);
            const slotCounts = srcInv.getSlots().get(name);
            if (slotCounts !== undefined)
                // for every slot in inventory, given it is defined
                for (const [fromSlot] of slotCounts) {
                    // move items to destination, up to limit - new limit = old limit - amount moved
                    limit -= srcInv.pushItems(destInv, fromSlot, limit);
                    if (limit <= 0) return startingLimit;
                }
        }
        return startingLimit - limit;
    }

    moveOneToMany(from: string, to: LuaSet<string>) {
        const srcInv = this.getInventory(from);
        for (const destStr of to) {
            // for each dest inventory
            const destInv = this.getInventory(destStr);
            for (const [fromSlot] of pairs(srcInv.list()))
                // push items from source to destination
                srcInv.pushItems(destInv, fromSlot);
        }
    }
}