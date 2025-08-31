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
    ProgressBar,
    getConsent
} from "./lib/utils";
import { Data } from "./lib/data";
import { expressionCompletor, expressionEvaluator, expressionValidator } from "./lib/expressions";

const submenus = {
    C(instance: Data) {
        // gather data for input
        const outputChest = instance.storage.getInventory(settings.get("castlr.outputChest"));
        if (outputChest === undefined) {
            error("Output chest not set! Please review installation instructions.", 1);
        }
        outputChest.syncData();
        const max = outputChest.getItemLimit(1) * outputChest.size();
        const craftableItems: string[] = [];
        for (const recipe of instance.getAllRecipes())
            craftableItems.push(recipe.output.name);
        const items = instance.storage.getItemNames(craftableItems);
        // get input
        const [name, count] = correctableInput(
            ["item to craft", "amount to craft"],
            [namespaceValidator, expressionValidator(1, max)],
            [stringCompletor(items), expressionCompletor]
        );
        const [itemsUsed, recipeStack] = instance.gatherIngredients(name, expressionEvaluator(count));
        const itemUseStrs = [];
        const missingStrs = [];
        const currentStoreStrs = [];
        for (const [name, usedCount] of itemsUsed) {
            if (usedCount !== 0) {
                const strVal = `${name} x ${usedCount}`;
                const storeCount = instance.storage.getTotalItemCount(name);
                currentStoreStrs.push(`${name} x ${storeCount}`);
                if (storeCount < usedCount) missingStrs.push(strVal);
                itemUseStrs.push(strVal);
            }
        }
        term.clear();
        term.setCursorPos(1, 1);
        if (missingStrs.length > 0) {
            print("Error: the following items must be inserted:");
            displayPages(missingStrs, false);
            return;
        }
        print("The following items will be consumed:");
        displayPages(itemUseStrs, false);
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
            const outputChest = instance.storage.getInventory(recipeType.output);
            // submit items to crafter
            // repeat (recipe mult) times, round robin to allow for recipes with specific order
            // prevents overload of too many of the same item preventing the recipe being completed
            let repeatCount = 1;
            let countMultiplier = currentRecipe.count;
            if (currentRecipe.input.length > 1) {
                repeatCount = currentRecipe.count;
                countMultiplier = 1;
            }
            const targetItem = { name: currentRecipe.output.name, count: currentRecipe.output.count * currentRecipe.count };
            write(`Crafting: ${targetItem.name} x ${targetItem.count} `);
            const bar = new ProgressBar();
            for (const _ of $range(1, repeatCount))
                for (const inputItem of currentRecipe.input)
                    if (instance.storage.moveItemFromMany(instance.storage.getStoragesByType(StorageType.NotInput), recipeType.input, inputItem.name, inputItem.count * countMultiplier) < inputItem.count * countMultiplier) {
                        print(`Error crafting ${currentRecipe.output.name}`);
                        sleep(settings.get("castlr.period"));
                        return;
                    }

            let currentCount;
            do {
                outputChest.syncData();
                currentCount = outputChest.getItemCount(targetItem.name);
                bar.setProgress(currentCount / targetItem.count);
            } while (currentCount < targetItem.count);
        }
        instance.storage.moveItemFromMany(instance.storage.getStoragesByType(StorageType.NotInput), settings.get("castlr.outputChest"), name, expressionEvaluator(count));
        print(`Crafted ${name} x ${count}`);
        sleep(settings.get("castlr.period"));
    },
    A(instance: Data) {
        const submenuText = [
            "   T - add new type.",
            "   R - add new recipe.",
            "Entry to add: "
        ];
        const items = instance.storage.getItemNames();
        const branches = {
            /** @noSelf **/
            T() {
                const invs = instance.storage.getInventoryNames();
                const [typeID, inputChest, outputChest] = correctableInput(
                    [
                        "namespaced recipe ID",
                        "input chest ID",
                        "output chest ID"
                    ],
                    [namespaceValidator],
                    [, stringCompletor(invs), stringCompletor(invs)]
                );
                const saveLocation = fs.combine("./types/", `${splitString(typeID, ":")[1]}.json`);
                writeFile(saveLocation, textutils.serializeJSON({ typeID, input: inputChest, output: outputChest }));
                fs.makeDir(`./recipes/${splitString(typeID, ":")[1]}`);
            },
            /** @noSelf **/
            R() {
                const recipeTypeStrs = instance.getRecipeTypeIDs();
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
        const inputChest = instance.storage.getInventory(settings.get("castlr.inputChest"));
        if (inputChest === undefined) {
            error("Input chest not set! Please review installation instructions.", 1);
        }
        inputChest.syncData();
        if (getConsent("Also store items from outputs?")) {
            const asLuaSet = new LuaSet<string>();
            asLuaSet.add(settings.get("castlr.inputChest"));
            for (const recipeType of instance._recipeTypes)
                // do not take items from an output with no input
                // eg. cobble gens, vanilla farms
                // NOTE: include this in doc - set a recipe with no input to empty string else wont get detected
                // leading to a mass of items in storage unintentionally
                if (recipeType.input !== "" && recipeType.output !== settings.get("castlr.inputChest")) instance.storage.moveOneToMany(recipeType.output, asLuaSet);
        }
        instance.storage.moveOneToMany(settings.get("castlr.inputChest"), instance.storage.getStoragesByType(StorageType.Storage));
    },
    T(instance: Data) {
        const items = instance.storage.getItemNames();
        const [name] = correctableInput(
            ["item name"],
            [(name: string) => {
                const max = instance.storage.getTotalItemCount(name);
                print(`${max} x ${name} stored.`);
                return namespaceValidator(name);
            }],
            [stringCompletor(items)]
        );
        const max = instance.storage.getTotalItemCount(name);
        const [expression] = correctableInput(["amount to take"], [expressionValidator(0, max)], [expressionCompletor]);
        const intToTake = expressionEvaluator(expression);
        if (intToTake === 0) return;
        instance.storage.getInventory(settings.get("castlr.outputChest")).syncData();
        instance.storage.moveItemFromMany(instance.storage.getStoragesByType(StorageType.NotInput), settings.get("castlr.outputChest"), name, intToTake);
    },
    L(instance: Data) {
        const map = instance.storage.getAllItems();
        const strings: string[] = []
        for (const [name, count] of map)
            strings.push(`${name} x ${count}`);
        displaySearch(strings);
    },
    R(instance: Data) {
        instance.init();
    }
} as { [index: string]: undefined | ((this: void, instance: Data) => void) }

/**
 * Get the latest release tag.
 * @returns The tag name of the latest release, or undefined.
 */
function getReleaseDetails() {
    const versionTestURL = "https://api.github.com/repos/p4rty4nimAl/cct-castlr/releases/latest";
    if (!http.checkURL(versionTestURL)) return;
    const tagName = textutils.unserialiseJSON(http.get(versionTestURL)[0].readAll()).tag_name;
    return tagName;
}
/**
 * Creates essential directories and defines settings for CASTLR.
 * @returns Whether a restart is required.
 */
function install(): boolean {
    // Create directories, preventing crash on recipe/type addition
    fs.makeDir("./types/");
    fs.makeDir("./recipes/");
    // reset log file
    fs.open("castlr.log", "w")[0].close();
    /**
     * The settings for the program.
     * A user defined, constant value for a given run of the software that is accessible across
     * the entirety of the software is a good candidate for addition to settings.
     */
    settings.define("castlr.inputChest", {
        description: "The input chest for CASTLR.",
        default: "",
        type: "string"
    });
    settings.define("castlr.outputChest", {
        description: "The output chest for CASTLR.",
        default: "",
        type: "string"
    });
    settings.define("castlr.period", {
        description: "Time inserted after CASTLR operations to read output.",
        default: 2,
        type: "number"
    });
    if (http) {
        const currentVersion = settings.get("castlr._installed_version");
        const newVersion = getReleaseDetails();
        settings.define("castlr.version", {
            description: "The version of CASTLR to use.",
            default: newVersion,
            type: "string"
        });
        if (settings.get("castlr.version") !== currentVersion && currentVersion === undefined) {
            // update
            const url = "https://github.com/p4rty4nimAl/cct-castlr/releases/download/" + settings.get("castlr.version") + "/main.lua"
            if (!http.checkURL(url)) return;
            const response = http.get(url)[0];
            // check for failure / invalid version
            if (response === undefined) return;

            writeFile("castlr.lua", response.readAll());
            // persist version number
            settings.set("castlr._installed_version", settings.get("castlr.version"));
            settings.save();
            print(`Installed CASTLR ${settings.get("castlr.version")}.`);
            return true;
        }

    }
}
/**
 * The main loop of the program
 */
function main(): void {
    // reset terminal in case of a non-blank display
    term.clear();
    term.setCursorPos(1, 1);

    if (install()) {
        shell.run("main.lua");
        return;
    }

    for (const keyboard of peripheral.find("tm_keyboard"))
        (keyboard as KeyboardPeripheral).setFireNativeEvents(true);
    const menuStrings = [
        "Welcome to CASTLR! (" + settings.get("castlr._installed_version") + ")", // Computer Aided Storage, Technical Logistic Regulator
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
    while (true) {
        term.clear();
        term.setCursorPos(1, 1);
        const action = displayMenu(menuStrings);
        const process = submenus[action];
        if (process === undefined) {
            print("Invalid mode!");
        } else xpcall(() => process(instance), (error) => {
            printError(error);
            const file = fs.open("castlr.log", "a")[0];
            file.writeLine(debug.traceback(textutils.formatTime(os.time(), true) + " - ", 3));
            file.writeLine(error);
            file.close();
        });
        sleep(settings.get("castlr.period"));
    }
}

main();

/*
possible future features:
    optional secondary system:
    - write out recipes to disk for transfer - CraftOS already provides utilities for this
    - write out storage contents to file / pocket computer
    - rednet access - read only
    
    read material list output from litematica
    
    stream processing:
    - moving items as they are produced / space is made in input (current behaviour: move them all at once)
    - coroutine for each recipe
    - option to output crafts into storage - for users without a large chest mod

    display total capacity / used

    recipe lister
    - list all available recipes, searchable

    recipe visualiser
    - tree view
    - scrollable window

    prevent recipe loops (ingot <- block <- ingot)
*/