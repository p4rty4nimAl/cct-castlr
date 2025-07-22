import {
    writeFile,
    readFile,
    splitString,
    displayPages,
    endsWith,
    orderStrings
} from "./utils";
import { Inventory } from "./inventory";

const DEBUG = false;
/**
 * This is the data controller for CASTLR. 
 * It controls: Recipes and their types; settings; storages.
 */
export class Data {
    /**
     * 
     * A map of peripheral names as used in {@link peripheral.wrap}, to instances of {@link Inventory}
     */
    _inventories: LuaMap<string, Inventory>;

    /**
     * A set of all loaded recipe types.
     * This is a LuaSet, rather than an array, as the generated lua code is more readable.
     */
    _recipeTypes: LuaSet<RecipeType>;

    /**
     * A set of all loaded recipes.
     * This is a LuaSet, rather than an array, as the generated lua code is more readable.
     */
    _recipes: LuaSet<Recipe>;

    /**
     * The settings for the program.
     * A user defined, constant value for a given run of the software that is accessible across
     * the entirety of the software is a good candidate for addition to settings.
     */
    settings: Settings;

    /**
     * Stores inventory peripheral names by their {@link StorageType}.
     * This allows for access by type, using {@link getStoragesByType}.
     */
    _storagesByType: { [index in StorageType]: LuaSet<string> };

    /**
     * A temporary store of logs until they are written out to the user.
     */
    _log: string[] = [];

    /**
     * Creates a Data instance - Fields are not populated, and {@link init} should be called before using the instance.
     */
    constructor() {
        this._storagesByType = {
            [StorageType.Input]: new LuaSet(),
            [StorageType.Output]: new LuaSet(),
            [StorageType.Storage]: new LuaSet(),
            [StorageType.NotInput]: new LuaSet()
        };
    }

    /**
     * Initalise fields. In particular, this:
     * - Sets setting values, taking from settings.json, or the specified default value.
     * - Gathers recipes and their types read from ./recipes/ and ./types/, respectively.
     * - Filters storages by type, using data from recipe types.
     * - Wraps all connected inventory peripherals using {@link Inventory}.
     */
    init() {
        // load settings
        this.settings = textutils.unserialiseJSON(readFile("./settings.json"));
        this.settings.period = this.settings.period ?? 1;
        this.settings.inputChest = this.settings.inputChest ?? "left";
        this.settings.outputChest = this.settings.outputChest ?? "right";
        writeFile("./settings.json", textutils.serialiseJSON(this.settings));

        // load recipes / types, get storage types
        this.loadRecipeTypesFromDirectory("./types/");
        // save in _storagesByType
        const inputs = this._storagesByType[StorageType.Input];
        const outputs = this._storagesByType[StorageType.Output];
        const storages = this._storagesByType[StorageType.Storage];
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
        const newInvFuncs = [];
        for (const inv of peripheralNames) {
            const name = peripheral.getName(inv);
            let sType = StorageType.Storage;
            if (inputs.has(name)) {
                sType = StorageType.Input;
            } else if (outputs.has(name)) {
                sType = StorageType.Output;
            } else storages.add(name);
            newInvFuncs.push(() => {
                this._inventories.set(name, new Inventory(name, sType));
            });
        }
        parallel.waitForAll(...newInvFuncs);
    }

    /**
     * This first validates a recipe. It must:
     * - Be of a valid recipe type.
     * - Not produce an item with an existing recipe.
     * It then stores the recipe in the instance.
     * @param recipe An unvalidated recipe to insert.
     */
    _addRecipe(recipe: Recipe) {
        let hasExistingType = false;
        for (const existingType of this._recipeTypes)
            if (recipe.typeID === existingType.typeID) {
                hasExistingType = true;
                break;
            }
        if (!hasExistingType) {
            print("Recipe type must be declared before adding a recipe using it.");
            return;
        }
        for (const existingRecipe of this._recipes)
            if (recipe.output.name === existingRecipe.output.name) {
                print("Recipes with outputs matching another are not allowed.");
                return;
            }
        this._recipes.add(recipe);
    }

    /**
     * This first validates a recipe type. It must:
     * - Be a unique type.
     * It then stores the recipe type in the instance, and loads all linked recipes the the corresponding ./recipes/${type} directory.
     * @param recipe An unvalidated recipe to insert.
     */
    _addRecipeType(recipeType: RecipeType) {
        for (const existingType of this._recipeTypes)
            if (existingType.typeID === recipeType.typeID) {
                print("Recipe types with types matching another are not allowed.");
                return;
            }
        this._recipeTypes.add(recipeType);
        this._loadRecipesFromDirectory(fs.combine('./recipes/', splitString(recipeType.typeID, ":")[1]));
    }

    /**
     * This will load, non-recursively, all of the recipe JSONs in the given directory.
     * It calls {@link _addRecipe} for each one.
     * @param directory The directory to load recipes from.
     */
    _loadRecipesFromDirectory(directory: string) {
        const files = fs.list(directory);
        for (const i of $range(0, files.length - 1))
            if (endsWith(files[i], ".json"))
                this._addRecipe(textutils.unserialiseJSON(readFile(fs.combine(directory, files[i]))) as Recipe);
    }

    /**
     * The will load recipe types from the given directory, calling {@link _addRecipeType} for each.
     * @param directory The directory to load recipe types from.
     */
    loadRecipeTypesFromDirectory(directory: string) {
        this._recipeTypes = new LuaSet();
        this._recipes = new LuaSet();
        const files = fs.list(directory);
        for (const i of $range(0, files.length - 1))
            if (endsWith(files[i], ".json"))
                this._addRecipeType(textutils.unserialiseJSON(readFile(fs.combine(directory as string, files[i]))) as RecipeType);
    }

    /**
     * Gets the total amount of an item stored across all connected inventories by iterating through them.
     * @param name The name of the item to get the count of.
     * @returns The amount of that item that are stored.
     */
    getTotalItemCount(name: string) {
        let total = 0;
        for (const [,inventory] of this._inventories)
            total += inventory.getItemCount(name);
        return total;
    }

    /**
     * Iterates through each connected inventory, building a map of item name to total counts.
     * @returns A map of item names to their total counts.
     */
    getAllItems(): LuaMap<string, number> {
        const itemMap = new LuaMap<string, number>();
        for (const [, inv] of this._inventories)
            for (const [name] of inv.getSlots()) {
                const newCount = (itemMap.get(name) ?? 0) + inv.getItemCount(name);
                itemMap.set(name, newCount);
            }
        return itemMap;
    }

    /**
     * Iterates through all connected inventories to collate all unique item names. Additional names can be inserted.
     * @param insertedValues Values to insert into the ordered item names, for autocompletion of craftable items.
     * @returns An ordered list of item names.
     */
    getOrderedItemNames(insertedValues?: string[]): string[] {
        const uniqueNames = new LuaSet<string>();
        if (insertedValues !== undefined) for (const value of insertedValues) uniqueNames.add(value);
        for (const [, inv] of this._inventories)
            for (const [name] of inv.getSlots())
                uniqueNames.add(name);
        return orderStrings(uniqueNames);
    }

    /**
     * Iterates through all connected inventories to collate all unique peripheral names.
     * @returns An ordered list of inventory peripheral names.
     */
    getOrderedInventoryNames(): string[] {
        const uniqueNames = new LuaSet<string>();
        for (const [name] of this._inventories)
            uniqueNames.add(name);
        return orderStrings(uniqueNames);
    }

    getOrderedRecipeNames(): string[] {
    /**
     * Iterates through all stored recipe types to collate all type IDs.
     * @returns An ordered list of recipe type IDs.
     */
        const uniqueNames = new LuaSet<string>();
        for (const recipe of this._recipeTypes)
            uniqueNames.add(recipe.typeID);
        return orderStrings(uniqueNames);
    }

    /**
     * Allows access to inventory peripherals by their designated type: Input, Storage, Output.
     * They can also be filted by NotInput, a union type of Storage and Output.
     * @param sType The storage type to filter by.
     * @returns A list of storages, all of the type filtered.
     */
    getStoragesByType(sType: StorageType) {
        if (sType !== StorageType.NotInput)
            return this._storagesByType[sType];
        // for NotInput storage type, combine Storage and Output
        const storages = this._storagesByType[StorageType.Storage];
        for (const storage in this._storagesByType[StorageType.Output]) storages.add(storage);
        return storages;
    }

    /**
     * Look up a recipe type using its type ID.
     * @param typeID The typeID for the desired {@link RecipeType}.
     * @returns The {@link RecipeType} with the desired typeID.
     */
    getRecipeType(typeID: RecipeTypeIdentifier) {
        // typeID unique, return either matching recipe or undefined.
        for (const recipeType of this._recipeTypes)
            if (recipeType.typeID === typeID) return recipeType;
    }

    getRecipe(output: string) {
    /**
     * Look up a recipe using its output item name.
     * @param itemOutput The name of the output item for the desired {@link Recipe}.
     * @returns The {@link Recipe} with the desired output item.
     */
    getRecipe(itemOutput: string) {
        // output name unique, return either matching recipe or undefined.
        for (const recipe of this._recipes)
            if (recipe.output.name === output) return recipe;
    }

    /**
     * Accessor method: get all stored {@link Recipe}s
     * @returns All stored {@link Recipe}s as a LuaSet.
     */
    getAllRecipes() {
        return this._recipes;
    }

    /**
     * Access a single inventory peripheral by name, without wrapping it again.
     * @param name The name of the inventory peripheral to wrap.
     * @returns The underlying peripheral.
     */
    getInventory(name: string) {
        return this._inventories.get(name);
    }

    /**
     * This function will move items from a single source to many destinations.
     * It will only move a single item, up to the given limit.
     * @param from The name of the source inventory peripheral.
     * @param to The name of the destination inventory peripherals.
     * @param name The name of the item to move.
     * @param limit The maximum amount of the item to move.
     * @returns Whether the limit was reached successfully.
     */
    moveItemFromOne(from: string, to: LuaSet<string> | [string], name: string, limit: number): boolean {
        const srcInv = this._inventories.get(from);
        const srcSlots = srcInv.getSlots().get(name);
        if (srcSlots === undefined) return false;
        let amountMoved = 0;
        for (const destStr of to) {
            const destInv = this._inventories.get(destStr);
            for (const [fromSlot] of srcSlots) {
                amountMoved += srcInv.pushItems(destInv, fromSlot, limit);
                if (amountMoved === limit) return true;
            }
        }
        return false;
    }

    /**
     * This function will move items from many sources to a single desination.
     * It will only move a single item, up to the given limit.
     * @param from The list of source inventory peripherals.
     * @param to The destination inventory peripheral.
     * @param name The name of the item to move.
     * @param limit The maximum amount of the item to move.
     * @returns The amount of items moved.
     */
    moveItemFromMany(from: LuaSet<string>, to: string, name: string, limit: number): number {
        const destInv = this._inventories.get(to);
        const startingLimit = limit;
        // for each source inventory
        for (const srcInvStr of from) {
            const srcInv = this._inventories.get(srcInvStr);
            const slotCounts = srcInv.getSlots().get(name);
            if (slotCounts !== undefined)
                // log(`slotCounts defined`)
                // for every slot in inventory, given it is defined
                for (const [fromSlot] of slotCounts) {
                    // move items to destination, up to limit - new limit = old limit - amount moved
                    limit -= srcInv.pushItems(destInv, fromSlot, limit);
                    if (limit <= 0) return startingLimit;
                }
        }
        return startingLimit - limit;
    }

    /**
     * This function will move items from a single source to many desintations.
     * It will move every item from the source that can be moved into the destinations given.
     * @param from The source inventory to empty.
     * @param to A list of the destination inventories.
     */
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

    gatherIngredients(name: string, count: number) {
    /**
     * This function will find the necessary ingredients in storage.
     * It prioritises least amount of intermediate crafts, using any items in storage first.
     * If an item is not in storage, or cannot be crafted, it must be inserted.
     * @param name The item name to craft.
     * @param count The amount of the item to craft.
     * @returns A map of item names to their counts.
     * @returns An array, to be traversed as a stack upon which the crafting recipes to be performed are stored.
     */
        const itemsToGather: SlotDetail[] = [];
        const itemsGathered: LuaMap<string, number> = new LuaMap();
        const recipeStack: (Recipe & { count: number })[] = [];
        itemsToGather.push({ name, count });
        while (itemsToGather.length !== 0) {
            const currentOutput = itemsToGather.pop();
            // determine amount to craft, accounting for items in use by the recipe so far
            const currentUsage = itemsGathered.get(currentOutput.name) ?? 0;
            const totalCount = this.getTotalItemCount(currentOutput.name);
            // amount to craft = (amount to craft or take) - (available amount)
            const craftAmount = currentOutput.count - (totalCount - currentUsage);
            if (craftAmount > 0) {
                // find recipe, use first result (there should only ever be 0 or 1 recipes matching the filter)
                const recipeToUse = this.getRecipe(currentOutput.name) as Recipe & { count: number };
                if (recipeToUse !== undefined) {
                    // have recipe, but need to craft
                    // take all available, craft deficit
                    itemsGathered.set(currentOutput.name, totalCount);
                    // get multiplier
                    const recipeMultiplier = math.ceil(craftAmount / recipeToUse.output.count);
                    for (const item of recipeToUse.input)
                        itemsToGather.push({ name: item.name, count: item.count * recipeMultiplier });
                    recipeToUse.count = recipeMultiplier;
                    recipeStack.push(recipeToUse);
                // no recipe - take item
                } else itemsGathered.set(currentOutput.name, currentUsage + craftAmount);
            // have enough already - take item
            } else itemsGathered.set(currentOutput.name, currentUsage + currentOutput.count);
        }
        // resolve duplicates, preserve order
        const duplicateRecipes = new LuaMap<string, { firstSeen: number, totalRecipeCount: number }>();
        for (const i of $range(0, recipeStack.length - 1)) {
            const recipe = recipeStack[i];
            const currentData = duplicateRecipes.get(recipe.output.name) ?? { firstSeen: i, totalRecipeCount: 0 };
            currentData.totalRecipeCount += recipe.count;
            duplicateRecipes.set(recipe.output.name, currentData);
        }
        const newRecipeStack = [];
        for (const i of $range(0, recipeStack.length - 1)) {
            const recipe = recipeStack[i];
            const data = duplicateRecipes.get(recipe.output.name);
            if (i === data.firstSeen) {
                recipe.count = data.totalRecipeCount;
                newRecipeStack.push(recipe);
            }
        }
        return $multi(itemsGathered, newRecipeStack);
    }

    log(prefix: string) {
        return (val: string) => {
            this._log.push(`${prefix}: ${val}`);
    /**
     * Create a new prefixed logger function.
     * @param prefix The prefix to use for this logger.
     * @returns A logger function.
     */
        }
    }

    showLog() {
    /**
     * Displays all logs in pages to the user.
     */
        if (!DEBUG) return;
        displayPages(this._log);
        this._log = [];
    }
}
