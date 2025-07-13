import { 
    writeFile,
    splitString,
    input,
    menu,
    correctableInput,
    namespaceValidator,
    intValidator,
    paginator,
    stringCompletor
} from "./utils";
import { Data } from "./data";

const submenus = {
    C(instance: Data) {
        const outputChest = instance.getInventory(instance.settings.outputChest);
        outputChest.syncData();
        const max = outputChest.getItemLimit(1) * outputChest.size();
        const craftableItems = [];
        for (const recipe of instance.getAllRecipes())
            craftableItems.push(recipe.output.name);
        const items = instance.getOrderedItemNames(craftableItems);
        const [ name, count ] = correctableInput(
            ["item to craft", "amount to craft"], 
            [namespaceValidator, intValidator(1, max)],
            [stringCompletor(items)]
        );
        const [ itemsUsed, recipeStack ] = instance.gatherIngredients(name, tonumber(count));
        const itemUseStrs = [];
        const missingStrs = [];
        const currentStoreStrs = [];
        for (const [name, usedCount] of itemsUsed) {
            if (usedCount !== 0) {
                const strVal = `${name} x ${usedCount}`;
                const storeCount = instance.getTotalItemCount(name);
                currentStoreStrs.push(`${name} x ${storeCount}`);
                if (storeCount < usedCount) missingStrs.push(strVal);
                itemUseStrs.push(strVal);
            } 
        }
        if (missingStrs.length > 0) {
            print("Error: the following items must be inserted:")
            paginator(missingStrs);
            return;
        }
        if (input("Display current store counts? (Y/N): ") === "Y") paginator(currentStoreStrs);
        print("The following items will be consumed:")
        paginator(itemUseStrs);
        if (input("Is the above correct? (Y/N): ") !== "Y") return;
        while (recipeStack.length !== 0) {
            const currentRecipe = recipeStack.pop();
            const recipeType = instance.getRecipeType(currentRecipe.typeID);
            if (recipeType === undefined) {
                print(`Recipe to craft ${currentRecipe.output.name} not found!`);
                return;
            }
            const currentOutputChest = instance.getInventory(recipeType.output);
            // submit items to crafter
            // repeat (recipe mult) times, round robin to allow for recipes with specific order
            // prevents overload of too many of the same item preventing the recipe being completed
            let repeatCount = 1;
            let countMultiplier = currentRecipe.count;
            if (currentRecipe.input.length > 1) {
                repeatCount = currentRecipe.count;
                countMultiplier = 1;
            }
            for (const _ of $range(1, repeatCount))
                for (const inputItem of currentRecipe.input)
                    if (!instance.moveItemFromMany(instance.getStoragesByType(StorageType.NotInput), recipeType.input, inputItem.name, inputItem.count * countMultiplier))
                        print(`Error crafting ${currentRecipe.output.name}`);
            
            let timer = 0;
            const targetItem = { name: currentRecipe.output.name, count: currentRecipe.output.count * currentRecipe.count}
            while (currentOutputChest.getItemCount(targetItem.name) < targetItem.count) {
                sleep(instance.settings.period);
                timer += instance.settings.period;
                print(`Currently crafting: ${targetItem.count} x ${targetItem.name} (${timer}s)\n`);
                currentOutputChest.syncData();
            }
            print(`${targetItem.count} x ${targetItem.name} complete.`);
        }
        instance.moveItemFromMany(instance.getStoragesByType(StorageType.NotInput), instance.settings.outputChest, name, tonumber(count));
        sleep(instance.settings.period);
    }
    export function A(instance: Data) {
        const submenuText = [
            "   T - add new type.",
            "   R - add new recipe.",
            "Entry to add: "
        ];
        const items = instance.getOrderedItemNames();
        const branches = {
            /** @noSelf **/
            T() {
                const invs = instance.getOrderedInventoryNames();
                const [ typeID, inputChest, outputChest ] = correctableInput(  
                    [
                        "namespaced recipe ID", 
                        "input chest ID",
                        "output chest ID"
                    ],
                    [ namespaceValidator ],
                    [ , stringCompletor(invs), stringCompletor(invs) ]
                );
                const saveLocation = fs.combine("./types/", `${splitString(typeID, ":")[1]}.json`);
                writeFile(saveLocation, textutils.serializeJSON({ typeID, input: inputChest, output: outputChest }));
                fs.makeDir(`./recipes/${splitString(typeID, ":")[1]}`);
            },
            /** @noSelf **/
            R() {
                const recipes = instance.getOrderedRecipeNames();
                const [ typeID, outputItemID, outputItemCount ] = correctableInput(
                    [
                        "namespaced recipe ID", 
                        "output item ID",
                        "output item count"
                    ],
                    [ namespaceValidator, namespaceValidator, intValidator(1, 64) ],
                    [ stringCompletor(recipes), stringCompletor(items)]
                );
                let inputCount = -1;
                while (!(0 < inputCount && inputCount < 10))
                    inputCount = tonumber(input("Enter - recipe input count (1-9): ")) ?? -1;
                const inputStrings = [];
                const validationFuncs = [];
                const completionFuncs = [];
                for (let i = 0; i < inputCount; i++) {
                    inputStrings.push(`item ${i + 1} ID`);
                    inputStrings.push(`item ${i + 1} count`);

                    validationFuncs.push(namespaceValidator);
                    validationFuncs.push(intValidator(1, 64));
                    
                    completionFuncs[i * 2] = stringCompletor(items);
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
    }
    export function S(instance: Data) {
        instance.getInventory(instance.settings.inputChest).regenerateData();
        if (input("Also store items from outputs? (Y/N): ") === "Y") {
            const asLuaSet = new LuaSet<string>();
            asLuaSet.add(instance.settings.inputChest);
            for (const recipeType of instance._recipeTypes)
                // do not take items from an output with no input
                // eg. cobble gens, vanilla farms
                // NOTE: include this in doc - set a recipe with no input to empty string else wont get detected
                // leading to a mass of items in storage unintentionally
                if (recipeType.input !== "") instance.moveItemToMany(recipeType.output, asLuaSet);
        }
        instance.moveItemToMany(instance.settings.inputChest, instance.getStoragesByType(StorageType.Storage));
    }
    export function T(instance: Data) {
        const items = instance.getOrderedItemNames();
        const [ name ] = correctableInput(
            [ "item name" ], 
            [ (name: string) => {
                const max = instance.getTotalItemCount(name);
                print(`${max} x ${name} stored.`);
                return namespaceValidator(name);
            } ],
            [ stringCompletor(items) ]
        );
        const max = instance.getTotalItemCount(name);
        const [ amountToTake ] = correctableInput([ "amount to take" ], [ intValidator(0, max) ], [ undefined ]);
        const intToTake = tonumber(amountToTake);
        if (intToTake === 0) return;
        instance.log("TAKE")(`taking ${intToTake} x ${name}`);
        instance.getInventory(instance.settings.outputChest).syncData();
        instance.moveItemFromMany(instance.getStoragesByType(StorageType.NotInput), instance.settings.outputChest, name, intToTake);
    }
    export function L(instance: Data) {
        const map = instance.getAllItems();
        const strings = [];
        for (const [ name, count ] of map)
            strings.push(`${count} x ${name}`);
        paginator(strings);
    }
    export function R(instance: Data) {
        instance.init();
    }
}
function main() {
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
        } else {
            print("Invalid mode!");
            sleep(instance.settings.period);
        }
        instance.showLog();
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
    overall, fix inputs to support lowercase input properly
    parallel crafting?
*/