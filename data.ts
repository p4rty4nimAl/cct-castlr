import { 
    writeFile,
    readFile,
    splitString,
    paginator,
    endsWith,
    orderStrings
} from "./utils";
import { Inventory } from "./inventory";

const DEBUG = false;

export class Data {
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
    init() {
        print("Initalising..")
        // load settings
        this.settings = textutils.unserialiseJSON(readFile("./settings.json"));
        this.settings.period = this.settings.period ?? 1;
        this.settings.inputChest = this.settings.inputChest ?? "left";
        this.settings.outputChest = this.settings.outputChest ?? "right";
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
        const newInvFuncs = [];
        for (const inv of peripheralNames) {
            const name = peripheral.getName(inv);
            let sType = StorageType.Storage;
            if (inputs.has(name)) {
                sType = StorageType.Input;
            } else if (outputs.has(name)) {
                sType = StorageType.Output;
            } else storages.add(name);
            newInvFuncs.push(() => {this._inventories.set(name, new Inventory(name, sType))});
        }
        parallel.waitForAll(...newInvFuncs);
    }
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
        this._recipes.push(recipe);
    }
    _addRecipeType(recipeType: RecipeType) {
        for (const existingType of this._recipeTypes)
            if (existingType.typeID === recipeType.typeID) {
                print("Recipe types with types matching another are not allowed.");
                return;
            }
        this._recipeTypes.push(recipeType);
        this._loadRecipesFromDirectory(fs.combine('./recipes/', splitString(recipeType.typeID, ":")[1]));
    }
    _loadRecipesFromDirectory(directory: string) {
        const files = fs.list(directory);
        for (const i of $range(0, files.length - 1))
            if (endsWith(files[i], ".json"))
                this._addRecipe(textutils.unserialiseJSON(readFile(fs.combine(directory, files[i]))) as Recipe);
    }
    loadRecipeTypesFromDirectory(directory: string) {
        this._recipeTypes = [];
        this._recipes = [];
        const files = fs.list(directory);
        for (const i of $range(0,  files.length - 1))
            if (endsWith(files[i], ".json"))
                this._addRecipeType(textutils.unserialiseJSON(readFile(fs.combine(directory as string, files[i]))) as RecipeType);
    }
    getTotalItemCount(name: string) {
        let total = 0;
        for (const [ ,inventory] of this._inventories)
            total += inventory.getItemCount(name);
        return total;
    }
    getAllItems(): LuaMap<string, number> {
        const itemMap = new LuaMap<string, number>();
        for (const [, inv] of this._inventories)
            for (const [name, ] of inv.slots) {
                const newCount = (itemMap.get(name) ?? 0) + inv.getItemCount(name);
                itemMap.set(name, newCount);
            }
        return itemMap;
    }
    getOrderedItemNames(): string[] {
        const uniqueNames = new LuaSet<string>()
        for (const [, inv] of this._inventories)
            for (const [name, ] of inv.slots)
                uniqueNames.add(name);
        return orderStrings(uniqueNames);
    }
    getOrderedInventoryNames(): string[] {
        const uniqueNames = new LuaSet<string>();
        for (const [name, ] of this._inventories)
            uniqueNames.add(name);
        return orderStrings(uniqueNames);
    }
    getOrderedRecipeNames(): string[] {
        const uniqueNames = new LuaSet<string>();
        for (const recipe of this._recipeTypes)
            uniqueNames.add(recipe.typeID);
        return orderStrings(uniqueNames);
    }
    getStoragesByType(sType: StorageType) {
        if (sType !== StorageType.NotInput)
            return this._storagesByType[sType];
        const storages = this._storagesByType[StorageType.Storage];
        for (const storage in this._storagesByType[StorageType.Output]) storages.add(storage);
        return storages;
    }
    getRecipeType(typeID: RecipeTypeIdentifier) {
        // typeID unique, return either matching recipe or undefined.
        for (const recipeType of this._recipeTypes)
            if (recipeType.typeID === typeID) return recipeType;
    }
    getRecipe(output: string) {
        // output name unique, return either matching recipe or undefined.
        for (const recipe of this._recipes)
            if (recipe.output.name === output) return recipe;
    }
    getInventory(name: string) {
        return this._inventories.get(name);
    }
    // output -> storage, specific item
    moveItemFromOne(from: string, to: LuaSet<string> | [string], name: string, limit: number): boolean {
        const srcInv = this._inventories.get(from);
        const srcSlots = srcInv.slots.get(name);
        if (srcSlots === undefined) return false;
        let amountMoved = 0;
        for (const destStr of to) {
            const destInv = this._inventories.get(destStr);
            for (const [fromSlot, ] of srcSlots) {
                amountMoved += srcInv.pushItems(destInv, fromSlot, limit)
                if (amountMoved === limit) return true;
            }
        }
        return false;
    }
    // storage -> input
    moveItemFromMany(from: LuaSet<string>, to: string, name: string, limit: number): boolean {
        // const log = this.log("MIFM")
        const destInv = this._inventories.get(to);
        // for each source inventory
        for (const srcInvStr of from) {
            // log(`Using srcInvStr: ${srcInvStr}`)
            const srcInv = this._inventories.get(srcInvStr);
            const slotCounts = srcInv.slots.get(name);
            if (slotCounts !== undefined)
                // log(`slotCounts defined`)
                // for every slot in inventory, given it is defined
                for (const [fromSlot, ] of slotCounts) {
                    // move items to destination, up to limit - new limit = old limit - amount moved
                    limit -= srcInv.pushItems(destInv, fromSlot, limit);
                    // log(`moved items, new limit = ${limit}`)
                    if (limit <= 0) return true;
                }
        }
        return false;
    }
    // output -> storage
    moveItemToMany(from: string, to: LuaSet<string>) {
        const srcInv = this.getInventory(from);
        for (const destStr of to) {
            // for each dest inventory
            const destInv = this.getInventory(destStr);
            for (const [fromSlot, ] of pairs(srcInv.list()))
                // push items from source to destination
                srcInv.pushItems(destInv, fromSlot)
        }
    }
    gatherIngredients(name: string, count: number) {
        const itemsToGather: SlotDetail[] = [];
        const itemsGathered: LuaMap<string, number> = new LuaMap();
        const recipeStack: (Recipe & {count: number})[] = [];
        itemsToGather.push({ name, count });
        while (itemsToGather.length !== 0) {
            const currentOutput = itemsToGather.pop();
            // determine amount to craft, accounting for items in use by the recipe so far
            const currentUsage = itemsGathered.get(currentOutput.name) ?? 0;
            const totalCount = this.getTotalItemCount(currentOutput.name);
            const craftAmount = currentOutput.count - totalCount - currentUsage;
            if (craftAmount > 0) {
                // find recipe, use first result (there should only ever be 0 or 1 recipes matching the filter)
                const recipeToUse = this.getRecipe(currentOutput.name) as Recipe & {count: number}; 
                if (recipeToUse !== undefined) {
                    // have recipe, but need to craft
                    // take all available, craft deficit
                    itemsGathered.set(currentOutput.name, totalCount)
                    // get multiplier
                    const recipeMultiplier = math.ceil(craftAmount / recipeToUse.output.count);
                    for (const item of recipeToUse.input)
                        itemsToGather.push({ name: item.name, count: item.count * recipeMultiplier});
                    recipeToUse.count = recipeMultiplier;
                    recipeStack.push(recipeToUse);
                // no recipe - take item
                } else itemsGathered.set(currentOutput.name, currentUsage + craftAmount);
            // have enough already - take item
            } else itemsGathered.set(currentOutput.name, currentUsage + currentOutput.count);
            
        }
        return $multi(itemsGathered, recipeStack);
    }
    log(prefix: string) {
        return (val: string) => {
            this._log.push(`${prefix}: ${val}`);
        }
    } 
    showLog() {
        if (!DEBUG) return;
        paginator(this._log);
        this._log = [];
    }
}