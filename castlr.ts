import {
    writeFile,
    splitString,
    getInput,
    correctableInput,
    namespaceValidator,
    intValidator,
    displayPages,
    stringCompletor,
    displaySearch,
    ProgressBar,
    getConsent,
    runMenu
} from "./lib/utils";
import { Data } from "./lib/data";
import { expressionCompletor, expressionEvaluator, expressionValidator } from "./lib/expressions";

const addDefinitionMenu = {
    T(instance: Data) {
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
    R(instance: Data) {
        const items = instance.storage.getItemNames();
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
} as { [index: string]: (this: void, instance: Data) => void };
const rootMenu = {
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
            "Which would you like to add?",
            "   T - add new type.",
            "   R - add new recipe.",
            "Entry to add: "
        ];
        const process = runMenu(submenuText, addDefinitionMenu);
        if (process !== undefined) {
            process(instance);
            instance.loadRecipeTypesFromDirectory("./types/");
        }
    },
    S(instance: Data) {
        // TODO: show user storage capacity / used
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
} as { [index: string]: (this: void, instance: Data) => void };
/**
 * Get the tag specified by 'castlr.version'. Ensure http is available.
 * @returns The tag name of the latest release, or the tag set in 'castlr.version'.
 */
function getSelectedReleaseTag(): string | undefined {
    const version = settings.get("castlr.version");
    if (version !== "latest") return version;
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
    const logHeader = 
        "CASTLR Version: " + (settings.get("castlr._installed_version")) + "\n" +
        _HOST + "\n";

    writeFile("castlr.log", logHeader);
    // ensure all settings are loaded
    settings.load();
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

    if (!http) return;

    settings.define("castlr.version", {
        description: "The version of CASTLR to use.",
        default: "latest",
        type: "string"
    });

    const currentVersion: string | undefined = settings.get("castlr._installed_version");
    const desiredVersion: string | undefined = getSelectedReleaseTag();
    
    if (desiredVersion === undefined) return; // cannot determine version to install
    if (currentVersion !== undefined && desiredVersion === currentVersion) return; // already installed + up to date

    // update / install desired version
    
    const url = "https://github.com/p4rty4nimAl/cct-castlr/releases/download/" + desiredVersion + "/castlr.lua"
    if (!http.checkURL(url)) return;
    const response = http.get(url)[0];
    // check for failure / invalid version
    if (response === undefined) return;

    // write new version
    writeFile("castlr.lua.new", response.readAll());
    fs.delete("castlr.lua");
    fs.move("castlr.lua.new", "castlr.lua");

    // persist version number
    settings.set("castlr._installed_version", desiredVersion);
    settings.save();
    print(`Installed CASTLR ${desiredVersion}.`);
    return true;
};
/**
 * The main loop of the program
 */
function main(): void {
    // reset terminal in case of a non-blank display
    term.clear();
    term.setCursorPos(1, 1);

    if (install()) {
        shell.run("castlr.lua");
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
    if (instance.issues.conflict.length !== 0 || instance.issues.invalid.length !== 0) {
        const pagableStrings: string[] = [];
        for (const conflict of instance.issues.conflict) {
            pagableStrings.push("'" + conflict.first.path + "' conflicts with '" + conflict.second.path + "'");
            pagableStrings.push("Reason: " + conflict.reason);
        }
        for (const invalid of instance.issues.invalid) {
            pagableStrings.push("'" + invalid.path + "' is invalid.");
            pagableStrings.push("Reason: " + invalid.reason);
        }
        print("The following must be resolved before using CASTLR:")
        displayPages(pagableStrings, false);
        return;
    }
    while (true) {
        const process = runMenu(menuStrings, rootMenu);
        const [success, terminating] = xpcall(() => process(instance), (err) => {
            printError(err);
            if (err === "Terminated") return true;
            const file = fs.open("castlr.log", "a")[0];
            file.writeLine(debug.traceback(textutils.formatTime(os.time(), true) + " - ", 3));
            file.writeLine(err);
            file.close();
        });
        if (!success && terminating) break;
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

    recipe lister
    - list all available recipes, searchable

    recipe visualiser
    - tree view
    - scrollable window

    prevent recipe loops (ingot <- block <- ingot)

    convert datapacks to recipes
    - as automatic as possible, query user for clarification
*/