import {
    writeFile,
    splitString,
    getInput,
    displayMenu,
    correctableInput,
    namespaceValidator,
    intValidator,
    displayPages,
    stringCompletor,
    displaySearch,
    orderStrings,
    ProgressBar,
    getConsent
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
        const [name, count] = correctableInput(
            ["item to craft", "amount to craft"],
            [namespaceValidator, intValidator(1, max)],
            [stringCompletor(items)]
        );
        const [itemsUsed, recipeStack] = instance.gatherIngredients(name, tonumber(count));
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
            print("Error: the following items must be inserted:");
            displayPages(missingStrs);
            return;
        }
        if (getConsent("Display current store counts?")) displayPages(currentStoreStrs);
        print("The following items will be consumed:");
        displayPages(itemUseStrs);
        if (!getConsent("Is the above correct?")) return;
        // reset for progress bar positioning
        term.clear();
        term.setCursorPos(1, 1);
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
                    if (instance.moveItemFromMany(instance.getStoragesByType(StorageType.NotInput), recipeType.input, inputItem.name, inputItem.count * countMultiplier) < inputItem.count * countMultiplier)
                        print(`Error crafting ${currentRecipe.output.name}`);

            const targetItem = { name: currentRecipe.output.name, count: currentRecipe.output.count * currentRecipe.count };
            let currentCount;
            write(`Crafting: ${targetItem.name} x ${targetItem.count} `);
            const bar = new ProgressBar();
            do {
                currentOutputChest.syncData();
                currentCount = currentOutputChest.getItemCount(targetItem.name);
                bar.setProgress(currentCount / targetItem.count);
            } while (currentCount < targetItem.count);
        }
        instance.moveItemFromMany(instance.getStoragesByType(StorageType.NotInput), instance.settings.outputChest, name, tonumber(count));
        print(`Crafted ${name} x ${count}`);
        sleep(instance.settings.period);
    },
    A(instance: Data) {
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
                const [typeID, inputChest, outputChest] = correctableInput(
                    [
                        "namespaced recipe ID",
                        "input chest ID",
                        "output chest ID"
                    ],
                    [namespaceValidator],
                    // eslint-disable-next-line no-sparse-arrays
                    [, stringCompletor(invs), stringCompletor(invs)]
                );
                const saveLocation = fs.combine("./types/", `${splitString(typeID, ":")[1]}.json`);
                writeFile(saveLocation, textutils.serializeJSON({ typeID, input: inputChest, output: outputChest }));
                fs.makeDir(`./recipes/${splitString(typeID, ":")[1]}`);
            },
            /** @noSelf **/
            R() {
                const recipeTypeStrs = instance.getOrderedRecipeTypeIDs();
                const [typeID, outputItemID, outputItemCount] = correctableInput(
                    [
                        "namespaced recipe ID",
                        "output item ID",
                        "output item count"
                    ],
                    [namespaceValidator, namespaceValidator, intValidator(1, 64)],
                    [stringCompletor(recipeTypeStrs), stringCompletor(items)]
                );
                let inputCount = -1;
                while (!(0 < inputCount && inputCount < 10))
                    inputCount = tonumber(getInput("Enter - recipe input count (1-9): ")) ?? -1;
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
        } as { [index: string]: () => void };
        const process = branches[displayMenu(submenuText)];
        if (process !== undefined) process();
        instance.loadRecipeTypesFromDirectory("./types/");
    },
    S(instance: Data) {
        instance.getInventory(instance.settings.inputChest).syncData();
        if (getConsent("Also store items from outputs?")) {
            const asLuaSet = new LuaSet<string>();
            asLuaSet.add(instance.settings.inputChest);
            for (const recipeType of instance._recipeTypes)
                // do not take items from an output with no input
                // eg. cobble gens, vanilla farms
                // NOTE: include this in doc - set a recipe with no input to empty string else wont get detected
                // leading to a mass of items in storage unintentionally
                if (recipeType.input !== "") instance.moveOneToMany(recipeType.output, asLuaSet);
        }
        instance.moveOneToMany(instance.settings.inputChest, instance.getStoragesByType(StorageType.Storage));
    },
    T(instance: Data) {
        const items = instance.getOrderedItemNames();
        const [name] = correctableInput(
            ["item name"],
            [(name: string) => {
                const max = instance.getTotalItemCount(name);
                print(`${max} x ${name} stored.`);
                return namespaceValidator(name);
            }],
            [stringCompletor(items)]
        );
        const max = instance.getTotalItemCount(name);
        const [amountToTake] = correctableInput(["amount to take"], [intValidator(0, max)], [undefined]);
        const intToTake = tonumber(amountToTake);
        if (intToTake === 0) return;
        instance.log("TAKE")(`taking ${intToTake} x ${name}`);
        instance.getInventory(instance.settings.outputChest).syncData();
        instance.moveItemFromMany(instance.getStoragesByType(StorageType.NotInput), instance.settings.outputChest, name, intToTake);
    },
    L(instance: Data) {
        const map = instance.getAllItems();
        const strings = new LuaSet<string>();
        for (const [name, count] of map)
            strings.add(`${name} x ${count}`);
        displaySearch(orderStrings(strings));
    },
    R(instance: Data) {
        instance.init();
    }
} as { [index: string]: undefined | ((this: void, instance: Data) => void) }

function install() {
    fs.makeDir("./types/");
    fs.makeDir("./recipes/");
    writeFile("./settings.json", "{}");
}

function main() {
    if (fs.exists("./settings.json")) install();
    term.clear();
    term.setCursorPos(1, 1);
    for (const keyboard of peripheral.find("tm_keyboard"))
        (keyboard as KeyboardPeripheral).setFireNativeEvents(true);
    const menuStrings = [
        "Welcome to CASTLR!", // Computer Aided Storage, Technical Logistic Regulator
        "   C - craft an item.",
        "   A - add a new recipe / type.",
        "   S - store all items in input chest.",
        "   T - take an item.",
        "   L - list all stored items.",
        "   R - refresh stored data.",
        "Enter mode: "
    ];
    print("Initalising..");
    const instance = new Data();
    instance.init();
    while (true) {
        term.clear();
        term.setCursorPos(1, 1);
        const action = displayMenu(menuStrings);
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
IDEAS:
    try catch main loop
    catch errors, log somewhere? do not crash
    parallel crafting: requires
        - ui overhaul - progress bars
        - collate all duplicate crafting recipes in the stack
        - moving items as they become available over moving them all at once
*/