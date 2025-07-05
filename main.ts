import { writeFile, readFile, splitString, input, menu, correctableInput, namespaceValidator, intValidator, paginator, endsWith, orderStrings, stringCompletor } from "./utils";

const DEBUG = false;

/** @noSelf */
declare class KeyboardPeripheral implements IPeripheral {
    setFireNativeEvents(shouldFire: boolean): void
}

// storage system

const enum StorageType {
    Input, Output, Storage, NotInput
}
// type StorageType = "input" | "output" | "storage";
type RecipeTypeIdentifier = string;
type RecipeLocation = string;
type RecipeType = {
    typeID: RecipeTypeIdentifier,
    input: RecipeLocation,
    output: RecipeLocation
}
type Recipe = {
    typeID: RecipeTypeIdentifier,
    input: SlotDetail[],
    output: SlotDetail
}
type Settings = { 
    period: number, 
    inputChest: RecipeLocation, 
    outputChest: RecipeLocation 
}
// map of index to count
type SlotCounts = LuaMap<number, number>;

class Inventory {
    _peripheral: InventoryPeripheral;
    _list: { [index: number]: SlotDetail };
    type: StorageType;
    size: number;
    maxSlotCapacity: number;
    // map of (item name) to (map of (slot index) to (item count))
    slots: LuaMap<string, SlotCounts>;

    constructor(peripheralName: string, type: StorageType, size?: number) {
        this._peripheral = peripheral.wrap(peripheralName) as InventoryPeripheral;
        this.type = type;
        this.size = (size === undefined) ? this._peripheral.size() : size;
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
    *getNextAvailableSlot(name: string) {
        // check all slots of item - if none work, return empty slot
        const slotCounts = this.slots.get(name);
        if (slotCounts !== undefined)
            for (const [slot, count] of slotCounts)
                if (count < this.maxSlotCapacity)
                    yield slot;
        // return slot if empty, inventories are 1-indexed
        for (const i of $range(1, this.size))
            if (this._list[i] === undefined) {
                yield i;
                yield* this.getNextAvailableSlot(name);
            }
        print(`${peripheral.getName(this._peripheral)} is too full for ${name}`);
        return -1;
    }
    recieveItems(name: string, slot: number, count: number) {
        // update this.slots
        const slotCounts = this.slots.get(name)
        const currentAmount = slotCounts.get(slot)
        if (currentAmount !== undefined) {
            if (currentAmount + count > this.maxSlotCapacity) {
                print("issue - recieveItems called with excessive value")
            }
            slotCounts.set(slot, currentAmount + count);
        }
        // update this._list
        if (this._list[slot].name !== name) print("issue - recieveItems called with wrong name");
        this._list[slot].count += count;
    }
    pushItems(to: Inventory, fromSlot: number, limit?: number, toSlot?: number) {
        if (this.type === StorageType.Input) {
            print("Attempting to push items from an input storage");
            input("chance to terminate here")
        }
        const amountMoved = this._peripheral.pushItems(to, slot, limit, toSlot);
        const amountInSlot = this._list[slot].count;
        let newVal = amountInSlot - amountMoved;
        if (newVal === 0) newVal = undefined;
        this._list[slot].count = newVal;
        
        if (amountMoved !== 0) {
            for (const [, slotCounts] of this.slots) {
                // slotCounts.get(slot) returns either the value in the correct slot, or undefined if not in the correct item group
                const amountInSlot = slotCounts.get(slot);
                if (amountInSlot !== undefined) slotCounts.set(slot, newVal);
            }
        }
        return amountMoved;
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
}


class Data {
    // map of (peripheral name ) to (Inventory)
    _inventories: LuaMap<string, Inventory>;
    _recipeTypes: RecipeType[];
    _recipes: Recipe[];
    settings: Settings;
    _storagesByType: { [index in StorageType]: LuaSet<string> }
    _log: string[] = [];

    constructor() {
        this._inventories = new LuaMap();
        this._storagesByType = {
            [StorageType.Input]: new LuaSet(),
            [StorageType.Output]: new LuaSet(),
            [StorageType.Storage]: new LuaSet(),
            [StorageType.NotInput]: new LuaSet()
        };
    }
    init = () => {
        print("Initalising..")
        // load settings
        this.settings = textutils.unserialiseJSON(readFile("./settings.json"));
        if (this.settings.period === undefined) this.settings.period = 1;
        if (this.settings.inputChest === undefined) this.settings.inputChest = "left";
        if (this.settings.outputChest === undefined) this.settings.outputChest = "right";
        writeFile("./settings.json", textutils.serialiseJSON(this.settings));

        // load recipes / types, get storage types
        this.loadRecipeTypesFromDirectory("./types/");
        // save in _storagesByType
        const inputs = this._storagesByType[StorageType.Input]
        const outputs = this._storagesByType[StorageType.Output]
        const storages = this._storagesByType[StorageType.Storage]
        // treat outputChest like an input - do not store items, do not index
        inputs.add(this.settings.outputChest);
        // treat inputChest like an output - do not store items, do index
        outputs.add(this.settings.inputChest);
        for (const recipe of this._recipeTypes) {
            inputs.add(recipe.input);
            outputs.add(recipe.output);
        }

        // get inventory data
        this._inventories = new LuaMap();
        const peripheralNames = peripheral.find("inventory");
        for (const inv of peripheralNames) {
            const name = peripheral.getName(inv);
            let sType = StorageType.Storage;
            if (inputs.has(name)) {
                sType = StorageType.Input;
            } else if (outputs.has(name)) {
                sType = StorageType.Output;
            } else storages.add(name);

            this._inventories.set(name, new Inventory(name, sType));
        }
    }
    _addRecipe = (recipe: Recipe) => {
        if (recipe.typeID in this._recipeTypes.map(type => type.typeID)) {
            print("Recipe type must be declared before adding a recipe using it.");
            return;
        }
        if (recipe.output.name in this._recipes.map(recipe => recipe.output.name)) {
            print("Recipes with outputs matching another are not allowed.");
            return;
        }
        this._recipes.push(recipe);
    }
    _addRecipeType = (recipeType: RecipeType) => {
        if (recipeType.typeID in this._recipeTypes.map(type => type.typeID)) {
            print("Recipe types with types matching another are not allowed.");
            return; 
        }
        this._recipeTypes.push(recipeType);
        this._loadRecipesFromDirectory(fs.combine('./recipes/', splitString(recipeType.typeID, ":")[1]));
    }
    _loadRecipesFromDirectory = (directory: string) => {
        const files = fs.list(directory);
        for (const i of $range(0, files.length - 1)) {
            const filePath = fs.combine(directory, files[i]);
            if (endsWith(filePath, ".json"))
                this._addRecipe(textutils.unserialiseJSON(readFile(filePath)) as Recipe);
        }
    }
    loadRecipeTypesFromDirectory = (directory: string) => {
        this._recipeTypes = [];
        this._recipes = [];
        const files = fs.list(directory);
        for (const i of $range(0,  files.length - 1)) {
            const filePath = fs.combine(directory as string, files[i])
            if (endsWith(filePath, ".json"))
                this._addRecipeType(textutils.unserialiseJSON(readFile(filePath)) as RecipeType);
        }
    }
    getTotalItemCount = (name: string) => {
        let total = 0;
        for (const [ ,inventory] of this._inventories)
            total += inventory.getItemCount(name);
        return total;
    }
    getAllItems = (): LuaMap<string, number> => {
        const itemMap = new LuaMap<string, number>();
        for (const [, inv] of this._inventories)
            for (const [name, ] of inv.slots) {
                const newCount = (itemMap.get(name) ?? 0) + inv.getItemCount(name);
                itemMap.set(name, newCount);
            }
        return itemMap;
    }
    getOrderedItemNames = (): string[] => {
        const uniqueNames = new LuaSet<string>()
        for (const [, inv] of this._inventories)
            for (const [name, ] of inv.slots)
                uniqueNames.add(name);
        return orderStrings(uniqueNames);
    }
    getOrderedInventoryNames = (): string[] => {
        const uniqueNames = new LuaSet<string>();
        for (const [name, ] of this._inventories)
            uniqueNames.add(name);
        return orderStrings(uniqueNames);
    }
    getOrderedRecipeNames = (): string[] => {
        const uniqueNames = new LuaSet<string>();
        for (const recipe of this._recipeTypes)
            uniqueNames.add(recipe.typeID);
        return orderStrings(uniqueNames);
    }
    getStoragesByType = (type: StorageType) => {
        if (type !== StorageType.NotInput)
            return this._storagesByType[type];
        const storages = this._storagesByType[StorageType.Storage];
        for (const storage in this._storagesByType[StorageType.Output]) storages.add(storage);
        return storages;
    }
    getRecipeType = (typeID: RecipeTypeIdentifier) => {
        // typeID unique, return either matching recipe or undefined.
        return this._recipeTypes.filter(recipe => recipe.typeID === typeID)[0];
    }
    moveItemFromOne = (from: string, to: LuaSet<string> | [string], name: string, count: number): boolean => {
        const srcInv = this._inventories.get(from);
        for (const destInvStr of to) {
            const destInv = this._inventories.get(destInvStr);
            const availableSlots = destInv.getNextAvailableSlot(name);
            let nextVal = {} as { value: number, done?: boolean};
            if (srcInv.slots.get(name) !== undefined) {
                for (const [slot, ] of srcInv.slots.get(name)) {
                    nextVal = availableSlots.next();
                    if (count <= 0) return true;
                    // no more slots available in destination - use next inventory
                    if (nextVal.done) break;
                    count -= srcInv.pushItems(destInvStr, slot, count, nextVal.value);
                }
                if (nextVal.done) break;
            }
        }
        return count <= 0;
    }
    moveItemFromMany = (from: LuaSet<string>, to: string, name: string, count: number): boolean => {
        const destInv = this._inventories.get(to);
        const availableSlots = destInv.getNextAvailableSlot(name);
        let nextVal = {} as { value: number, done?: boolean};
        for (const srcInvStr of from) {
            const srcInv = this._inventories.get(srcInvStr);
            if (srcInv.slots.get(name) !== undefined) {
                for (const [slot, ] of srcInv.slots.get(name)) {
                    nextVal = availableSlots.next();
                    // no more slots available in destination - move to next / fail
                    if (nextVal.done) break;
                    count -= srcInv.pushItems(to, slot, count, nextVal.value);
                    if (count <= 0) return true;
                }
                // no more slots available in destination - fail
                if (nextVal.done) break;
            }
        }
        return count <= 0;
    }
    moveItemToMany = (from: string, to: LuaSet<string>) => {
        // 1-m transfer
        // scummy function abusing internals
        const inv = this._inventories.get(from);
        // reset if output as items may be untracked
        if (inv.type === StorageType.Output) inv.regenerateData();
        const srcInv = inv._peripheral;
        const srcInvList = this._inventories.get(from)._list;
        for (const destInv of to) {
            let currentDirty = false;
            for (const [slot, ] of pairs(srcInvList)) {
                const amountMoved = srcInv.pushItems(destInv, slot);
                if (amountMoved !== 0) currentDirty = true;
                srcInvList[slot].count -= amountMoved;
                if (srcInvList[slot].count === 0) srcInvList[slot] = undefined;
            }
            if (currentDirty) this._inventories.get(destInv).regenerateData();
        }
        inv.regenerateData();
    }
    gatherIngredients = (name: string, count: number) => {
        const itemsToGather: SlotDetail[] = [];
        const itemsGathered: LuaMap<string, number> = new LuaMap();
        const recipes: (Recipe & {count: number})[] = [];
        itemsToGather.push({ name, count });
        while (itemsToGather.length !== 0) {
            const currentOutput = itemsToGather.pop();
            // determine amount to craft, accounting for items in use by the recipe so far
            let currentUsage = itemsGathered.get(currentOutput.name);
            if (currentUsage === undefined) currentUsage = 0;
            const totalCount = this.getTotalItemCount(currentOutput.name);
            const craftAmount = currentOutput.count - totalCount - currentUsage;
            if (craftAmount > 0) {
                // find recipe, use first result (there should only ever be 0 or 1 recipes matching the filter)
                const recipeToUse = this._recipes.filter(recipe => recipe.output.name === currentOutput.name)[0];
                if (recipeToUse !== undefined) {
                    // have recipe, but need to craft
                    // take all available, craft deficit
                    itemsGathered.set(currentOutput.name, totalCount)
                    // get multiplier
                    const recipeMultiplier = math.ceil(craftAmount / recipeToUse.output.count);
                    for (const item of recipeToUse.input)
                        itemsToGather.push({ name: item.name, count: item.count * recipeMultiplier});
                    recipes.push({ ...recipeToUse, count: recipeMultiplier });
                // no recipe - take item
                } else itemsGathered.set(currentOutput.name, currentUsage + craftAmount);
            // have enough already - take item
            } else itemsGathered.set(currentOutput.name, currentUsage + currentOutput.count);
            
        }
        return $multi(itemsGathered, recipes);
    }
    log = (prefix: string) => (val: string) => this._log.push(`${prefix}: ${val}`);
    showLog = () => {
        if (!DEBUG) return;
        paginator(this._log);
        this._log = [];
    }
}
const submenus = {
    C: (instance: Data) => {
        const outputChest = instance._inventories.get(instance.settings.outputChest)
        const max = outputChest.maxSlotCapacity * outputChest.size;
        const orderedAllowedItems = instance.getOrderedItemNames();
        const [ name, count ] = correctableInput(
            ["item to craft", "amount to craft"], 
            [namespaceValidator, intValidator(1, max)],
            [stringCompletor(orderedAllowedItems)]
        );
        // hold from storage count to force gatherIngredients to craft it, rather than take from storage.
        const [ itemsUsed, overallRecipe ] = instance.gatherIngredients(name, tonumber(count));
        const itemUseStrings = [];
        const missingStrings = [];
        for (const [name, count] of itemsUsed) {
            if (count !== 0) {
                const strVal = `${name} x ${count}`;
                const isMissing = instance.getTotalItemCount(name) - count < 0;
                if (isMissing) missingStrings.push(strVal);
                itemUseStrings.push(strVal);
            } 
        }
        if (missingStrings.length !== 0) {
            print("Error: the following items must be inserted:")
            paginator(missingStrings);
            return;
        }
        print("The following items will be consumed:")
        paginator(itemUseStrings);
        if (input("Is the above correct? (Y/N): ") !== "Y") return;
        for (const currentRecipe of overallRecipe.reverse()) {
            const recipeType = instance.getRecipeType(currentRecipe.typeID);
            if (recipeType === undefined) {
                print(`Recipe to craft ${currentRecipe.output.name} not found!`);
                return;
            }
            const currentOutputChest = instance._inventories.get(recipeType.output);
            // submit items to crafter
            // repeat (recipe mult) times, round robin to allow for recipes with specific order
            // prevents overload of too many of the same item preventing the recipe being completed
            // TODO: may need gating behind a recipe flag, if slow
            for (const i of $range(1, currentRecipe.count))
                for (const inputItem of currentRecipe.input)
                    if (!instance.moveItemFromMany(instance.getStoragesByType(StorageType.NotInput), recipeType.input, inputItem.name, inputItem.count))
                        print(`Error crafting ${currentRecipe.output.name}`);
            let timer = 0;
            const targetItem = { name: currentRecipe.output.name, count: currentRecipe.output.count * currentRecipe.count}
            while (currentOutputChest.getItemCount(targetItem.name) < targetItem.count) {
                sleep(instance.settings.period);
                timer += instance.settings.period;
                print(`Currently crafting: ${targetItem.count} x ${targetItem.name} (${timer}s)\n`);
                currentOutputChest.regenerateData();
            }
            // take more time here, avoid missing items in next transfer?
            print(`${targetItem.count} x ${targetItem.name} complete.`);
        }
        instance.moveItemFromMany(instance.getStoragesByType(StorageType.NotInput), instance.settings.outputChest, name, tonumber(count));
    },
    A: (instance: Data) => {
        const submenuText = [
            "   T - add new type.",
            "   R - add new recipe.",
            "Entry to add: "
        ];
        const orderedAllowedItems = instance.getOrderedItemNames();
        const branches = {
            T() {
                const orderedAllowedInventories = instance.getOrderedInventoryNames();
                const [ typeID, inputChest, outputChest ] = correctableInput(  
                    [
                        "namespaced recipe ID", 
                        "input chest ID",
                        "output chest ID"
                    ],
                    [ namespaceValidator ],
                    [ stringCompletor(orderedAllowedItems), stringCompletor(orderedAllowedInventories), stringCompletor(orderedAllowedInventories) ]
                );
                const saveLocation = fs.combine("./types/", `${splitString(typeID, ":")[1]}.json`);
                writeFile(saveLocation, textutils.serializeJSON({ typeID, input: inputChest, output: outputChest }));
                fs.makeDir(`./recipes/${splitString(typeID, ":")[1]}`);
            },
            R() {
                const orderedAllowedRecipes = instance.getOrderedRecipeNames();
                const [ typeID, outputItemID, outputItemCount ] = correctableInput(
                    [
                        "namespaced recipe ID", 
                        "output item ID",
                        "output item count"
                    ],
                    [ namespaceValidator, namespaceValidator, intValidator(1, 64) ],
                    [ stringCompletor(orderedAllowedRecipes), stringCompletor(orderedAllowedItems)]
                );
                let inputCount = -1;
                while (!(0 < inputCount && inputCount < 10)) {
                    inputCount = tonumber(input("Enter - recipe input count (1-9): "));
                    if (inputCount === undefined) inputCount = -1;
                }
                const inputStrings = [];
                const validationFuncs = [];
                const completionFuncs = [];
                for (let i = 0; i < inputCount; i++) {
                    inputStrings.push(`item ${i + 1} ID`);
                    inputStrings.push(`item ${i + 1} count`);

                    validationFuncs.push(namespaceValidator);
                    validationFuncs.push(intValidator(1, 64));
                    
                    completionFuncs[i * 2] = stringCompletor(orderedAllowedItems);
                }
                const inputItemsRaw = correctableInput(inputStrings, validationFuncs, completionFuncs);
                const inputItems = [];
                for (let i = 0; i < inputItemsRaw.length; i += 2)
                    inputItems.push({ name: inputItemsRaw[i], count: tonumber(inputItemsRaw[i + 1]) });
                
                const saveLocation = fs.combine("./recipes/", splitString(typeID, ":")[1], `${splitString(outputItemID, ":")[1]}.json`);
                writeFile(saveLocation, textutils.serialiseJSON({ typeID, input: inputItems, output: { name: outputItemID, count: tonumber(outputItemCount) } }));
            }
        }
        const process = branches[menu(submenuText)];
        if (process !== undefined) process();
        instance.loadRecipeTypesFromDirectory("./types/");
    },
    S: (instance: Data) => {
        const shouldClearOutputs = input("Also store items from outputs? (Y/N): ") === "Y";
        if (shouldClearOutputs) {
            const asLuaSet = new LuaSet<string>();
            asLuaSet.add(instance.settings.inputChest);
            for (const outputInv of instance.getStoragesByType(StorageType.Output)) {
                // filter out outputs with no inputs - e.g. cobble gens, vanilla farms
                const recipeTypeGivenOutput = instance._recipeTypes.filter(type => type.output === outputInv);
                if (recipeTypeGivenOutput.length > 0) {
                    // NOTE: include this in doc - set a recipe with no input to empty string else wont get detected
                    // leading to a mass of items in storage unintentionally
                    for (const recipeType of recipeTypeGivenOutput) 
                        if (recipeType.input !== "") {
                            instance.moveItemToMany(outputInv, asLuaSet);
                        }
                }
            }
        }
        instance.moveItemToMany(instance.settings.inputChest, instance.getStoragesByType(StorageType.Storage));
    },
    T: (instance: Data) => {
        const allowedOrderedItems = instance.getOrderedItemNames();
        const [ name ] = correctableInput(
            [ "item name" ], 
            [ (name: string) => {
                const max = instance.getTotalItemCount(name);
                print(`${max} x ${name} stored.`);
                return namespaceValidator(name);
            } ],
            [ stringCompletor(allowedOrderedItems) ]
        );
        const max = instance.getTotalItemCount(name);
        const [ amountToTake ] = correctableInput([ "amount to take" ], [ intValidator(0, max) ], [ undefined ]);
        const intToTake = tonumber(amountToTake);
        if (intToTake === 0) return;
        instance.log("TAKE")(`taking ${intToTake} x ${name}`);
        instance.moveItemFromMany(instance.getStoragesByType(StorageType.NotInput), instance.settings.outputChest, name, intToTake);
    },
    L: (instance: Data) => {
        const map = instance.getAllItems();
        const strings = [];
        for (const [ name, count ] of map)
            strings.push(`${count} x ${name}`);
        paginator(strings);
    },
    R: (instance: Data) => instance.init()
}
const main = () => {
    term.clear();
    term.setCursorPos(1, 1);
    for (const keyboard of peripheral.find("tm_keyboard"))
        (keyboard as KeyboardPeripheral).setFireNativeEvents(true);
    const instance = new Data();
    instance.init();
    const menuStrings = [
        "Welcome to CASTLR!", // Computer Aided Storage, Technical Logistic Regulator
        "   C - craft an item.",
        "   A - add a new recipe / type.",
        "   S - store all items in input chest.",
        "   T - take an item.",
        "   L - list all stored items.",
        "   R - refresh stored data.",
        "Enter mode: "
    ]
    while (true) {
        term.clear();
        term.setCursorPos(1, 1);
        const action = menu(menuStrings)
        const process = submenus[action];
        if (process !== undefined) {
            process(instance);
        } else print("Invalid mode!")
        sleep(instance.settings.period);
        if (DEBUG) instance.showLog();
    }
}

main();

// notes:
/*
make documentation, suggest human:input recipe type
    - allows to drop settings.inputChest + outputChest from most/some special considerations
BUGS:
    craft
IDEAS:
    try catch main loop
    catch errors, log somewhere? do not crash
*/