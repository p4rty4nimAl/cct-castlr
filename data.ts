import {
    readFile,
    splitString,
    endsWith
} from "./utils";
import { Storage } from "./storage";

export interface Data {
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
     * Reference to {@link Storage}, which controls inventory peripheral access.
     * This allows for access by type, using {@link Storage.getStoragesByType}.
     */
    storage: Storage;

    /**
     * Creates a Data instance - Fields are initalised using {@link init}.
     */
    constructor(): void;

    /**
     * Initalise fields. In particular, this:
     * - Gathers recipes and their types read from ./recipes/ and ./types/, respectively.
     * - Generates storage type sets, using data from recipe types.
     * - Wraps all connected inventory peripherals using {@link Storage}.
     */
    init(): void;

    /**
     * This first validates a recipe. It must:
     * - Be of a valid recipe type.
     * - Not produce an item with an existing recipe.
     * It then stores the recipe in the instance.
     * @param recipe An unvalidated recipe to insert.
     */
    _addRecipe(recipe: Recipe): void;

    /**
     * This first validates a recipe type. It must:
     * - Be a unique type.
     * It then stores the recipe type in the instance, and loads all linked recipes the the corresponding ./recipes/${type} directory.
     * @param recipe An unvalidated recipe to insert.
     */
    _addRecipeType(recipeType: RecipeType): void;

    /**
     * This will load, non-recursively, all of the recipe JSONs in the given directory.
     * It calls {@link _addRecipe} for each one.
     * @param directory The directory to load recipes from.
     */
    _loadRecipesFromDirectory(directory: string): void;

    /**
     * Iterates through all stored recipe types to collate all type IDs.
     * @returns An ordered list of recipe type IDs.
     */
    getRecipeTypeIDs(): string[];

    /**
     * Look up a recipe type using its type ID.
     * @param typeID The typeID for the desired {@link RecipeType}.
     * @returns The {@link RecipeType} with the desired typeID.
     */
    getRecipeType(typeID: RecipeTypeIdentifier): RecipeType | undefined;

    /**
     * Look up a recipe using its output item name.
     * @param itemOutput The name of the output item for the desired {@link Recipe}.
     * @returns The {@link Recipe} with the desired output item.
     */
    getRecipe(itemOutput: string): Recipe | undefined;

    /**
     * Accessor method: get all stored {@link Recipe}s
     * @returns All stored {@link Recipe}s as a LuaSet.
     */
    getAllRecipes(): LuaSet<Recipe>;

    /**
     * This function will find the necessary ingredients in storage.
     * It prioritises least amount of intermediate crafts, using any items in storage first.
     * If an item is not in storage, or cannot be crafted, it must be inserted.
     * @param name The item name to craft.
     * @param count The amount of the item to craft.
     * @returns A map of item names to their counts.
     * @returns An array, to be traversed as a stack upon which the crafting recipes to be performed are stored.
     */
    gatherIngredients(name: string, count: number): [LuaMap<string, number>, (Recipe & { count: number })[]];

    
}

/**
 * This is the data controller for CASTLR. 
 * It controls: Recipes and their types.
 */
export class Data {
    _recipeTypes: LuaSet<RecipeType>;
    _recipes: LuaSet<Recipe>;

    storage: Storage;

    constructor() {
        this.init();
    }

    init() {
        // load recipes / types, get storage types
        this.loadRecipeTypesFromDirectory("./types/");

        const inputs = new LuaSet<string>();
        const outputs = new LuaSet<string>();
        const storages = new LuaSet<string>();
        const notInputs = new LuaSet<string>();
        // treat outputChest like an input - do not store items, do not index
        inputs.add(settings.get("castlr.outputChest"));
        // treat inputChest like an output - do not store items, do index
        outputs.add(settings.get("castlr.inputChest"));
        for (const recipe of this._recipeTypes) {
            inputs.add(recipe.input);
            outputs.add(recipe.output);
        }

        // get inventory data
        const peripherals = peripheral.find("inventory");
        for (const inv of peripherals) {
            const name = peripheral.getName(inv);
            if (!inputs.has(name)) {
                notInputs.add(name);
                if (!outputs.has(name)) storages.add(name);
            }
        }
        this.storage = new Storage({
            [StorageType.Input]: inputs,
            [StorageType.Output]: outputs,
            [StorageType.Storage]: storages,
            [StorageType.NotInput]: notInputs
        }, peripherals);
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
        this._recipes.add(recipe);
    }

    _addRecipeType(recipeType: RecipeType) {
        for (const existingType of this._recipeTypes)
            if (existingType.typeID === recipeType.typeID) {
                print("Recipe types with types matching another are not allowed.");
                return;
            }
        this._recipeTypes.add(recipeType);
        this._loadRecipesFromDirectory(fs.combine('./recipes/', splitString(recipeType.typeID, ":")[1]));
    }

    _loadRecipesFromDirectory(directory: string) {
        const files = fs.list(directory);
        for (const i of $range(0, files.length - 1))
            if (endsWith(files[i], ".json"))
                this._addRecipe(textutils.unserialiseJSON(readFile(fs.combine(directory, files[i]))) as Recipe);
    }

    loadRecipeTypesFromDirectory(directory: string) {
        this._recipeTypes = new LuaSet();
        this._recipes = new LuaSet();
        const files = fs.list(directory);
        for (const i of $range(0, files.length - 1))
            if (endsWith(files[i], ".json"))
                this._addRecipeType(textutils.unserialiseJSON(readFile(fs.combine(directory as string, files[i]))) as RecipeType);
    }

    getRecipeTypeIDs(): string[] {
        const uniqueNames: string[] = [];
        for (const recipe of this._recipeTypes)
            uniqueNames.push(recipe.typeID);
        return uniqueNames;
    }

    getRecipeType(typeID: RecipeTypeIdentifier) {
        // typeID unique, return either matching recipe or undefined.
        for (const recipeType of this._recipeTypes)
            if (recipeType.typeID === typeID) return recipeType;
    }

    getRecipe(itemOutput: string) {
        // output name unique, return either matching recipe or undefined.
        for (const recipe of this._recipes)
            if (recipe.output.name === itemOutput) return recipe;
    }

    getAllRecipes() {
        return this._recipes;
    }

    gatherIngredients(name: string, count: number): [LuaMap<string, number>, (Recipe & { count: number })[]] {
        const itemsToGather: SlotDetail[] = [];
        const itemsGathered: LuaMap<string, number> = new LuaMap();
        const recipeStack: (Recipe & { count: number })[] = [];
        itemsToGather.push({ name, count });
        while (itemsToGather.length !== 0) {
            const currentOutput = itemsToGather.pop();
            // determine amount to craft, accounting for items in use by the recipe so far
            const currentUsage = itemsGathered.get(currentOutput.name) ?? 0;
            const totalCount = this.storage.getTotalItemCount(currentOutput.name);
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
        const newRecipeStack: (Recipe & { count: number })[] = [];
        for (const i of $range(0, recipeStack.length - 1)) {
            const recipe = recipeStack[i];
            const data = duplicateRecipes.get(recipe.output.name);
            if (i === data.firstSeen) {
                recipe.count = data.totalRecipeCount;
                newRecipeStack.push(recipe);
            }
        }
        return [itemsGathered, newRecipeStack];
    }
}
