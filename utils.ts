/** @noSelfInFile **/

/**
 * Writes data to a file, then closes it.
 * @param path Path of the file to write.
 * @param data Data to write to the file.
 */
export const writeFile = (path: string, data: string) => {
    const [file, err] = fs.open(path, "w");
    if (err !== undefined) return;
    file.write(data);
    file.close();
}
/**
 * Reads data from a file, then closes it.
 * @param path Path of the file to read.
 */
export const readFile = (path: string) => {
    const [file, err] = fs.open(path, "r");
    if (err !== undefined) return "";
    const data = file.readAll();
    file.close();
    return data;
};
type InputOptions = {
    replaceChar?: string
    history?: string[]
    completeFn?: (this: void, partial: string) => string[]
    presetInput?: string
}
/**
 * Function to prompt a user for an input, returning it without validation.
 * Has options for a replacement character, history, completion function, and preset input.
 * @param prompt The string to display to the user.
 * @param options {@link https://tweaked.cc/module/_G.html#v:read}
 * @returns The value entered by the user.
 */
export const getInput = (prompt: string, options: InputOptions = {}) => {
    write(prompt);
    return read(options.replaceChar, options.history, options.completeFn, options.presetInput);
}
/**
 * Check with the user that the above is correct.
 * @param prompt The string representing what the user is consenting to.
 * @returns If the user consented to proceeding.
 */
export const getConsent = (prompt: string) => {
    const options = { completeFn: stringCompletor(["N", "Y"]) };
    return string.lower(getInput(`${prompt} (Y/N): `, options)) === "y";
}
/**
 * Splits a string on a given separator.
 * @param value The string to split into multiple.
 * @param separator The string to use to separate the given value.
 * @returns The parts of the separated string.
 */
export const splitString = (value: string, separator: string): string[] => {
    const splitStrings = [];
    let pointer = 1;
    do {
        const [start, finish] = string.find(value, separator, pointer, true);
        if (start === undefined) {
            splitStrings.push(string.sub(value, pointer));
            return splitStrings;
        }
        splitStrings.push(string.sub(value, pointer, start - 1));
        pointer = finish + 1;
    } while (pointer < value.length);
    return splitStrings;
}
/**
 * Get a function to validate an integer between bounds.
 * @param min The minimum allowed value for a valid integer to take.
 * @param max The maximum allowed value for a valid integer to take.
 * @returns Function that validates an integer given as a string.
 */
export const intValidator = (min: number, max: number) => (int: string) => {
    const maybeInt = tonumber(int);
    return (maybeInt !== undefined) && min <= maybeInt && maybeInt <= max;
}
/**
 * Function to determine if a string should be accepted as a namespaced string.
 * @param value The string to validate.
 * @returns Whether the string is valid.
 */
export const namespaceValidator = (value: string) => splitString(value, ":").length === 2;
/**
 * Get strings that the current partial input could complete to.
 * @param possibleStrs The search space of strings to complete to.
 * @returns A function that returns the array of the remaining parts of possible completions given a partial string.
 */
export const stringCompletor = (possibleStrs: string[]) => {
    /** @noSelf **/
    return (partial: string) => {
        const completeValues: string[] = [];
        // if no input, return all.
        if (partial.length === 0) return possibleStrs;
        for (const str of possibleStrs) {
            if (string.sub(str, 1, partial.length) === partial)
                completeValues.push(string.sub(str, partial.length + 1));
        }
        return completeValues;
    }
}
/**
 * Get user-confident, valid inputs.
 * @param strings The prompts to show the user for each input.
 * @param conditions An optional function to ensure the given input is valid.
 * @param completeFns An optional function to grant the user autocompletion of inputs.
 * @returns An array of strings matching the user prompts given.
 */
export const correctableInput = (strings: string[], conditions: (((maybeValid: string) => boolean) | undefined)[], completeFns: (((this: void, partial: string) => string[]) | undefined)[]): LuaMultiReturn<string[]> => {
    conditions = conditions ?? [];
    const defaultValues: string[] = [];
    do {
        let i = 0;
        while (i < strings.length) {
            // formatting
            const newValue = getInput(`Enter - ${strings[i]}: `, { presetInput: defaultValues[i], completeFn: completeFns[i] });
            // accept input if valid or no condition
            if (conditions[i] === undefined || conditions[i](newValue)) {
                defaultValues[i] = newValue;
                i++;
            } // else retry
        }
    } while (!getConsent("Is the above correct?"));
    return $multi(...defaultValues);
}
/**
 * Multi-line wrapper / version of {@link getInput}.
 * @param displayText The strings, and user prompt for input.
 * @returns The user's input.
 */
export const displayMenu = (displayText: string[]): string => {
    for (const i of $range(0, displayText.length - 2))
        print(displayText[i]);
    return string.upper(getInput(displayText[displayText.length - 1]));
}
/**
 * Allow a user to parse a large amount of text at their own pace.
 * @param lines The strings to page through.
 * @param height The maximum amount of strings to display at once.
 */
export const displayPages = (lines: string[], fullscreen: boolean = true) => {
    let y = 1;
    if (!fullscreen) y = term.getCursorPos()[1];
    // if not in fullscreen, cannot use last line due to text at the top of the screen
    // scrolling out of view when input is recieved
    const pageSize = term.getSize()[1] - y - (fullscreen ? 0 : 1);
    const totalPages = Math.ceil(lines.length / pageSize);
    let currentPage = 1;
    while (currentPage <= totalPages) {
        term.setCursorPos(1, y);
        for (const i of $range((currentPage - 1) * pageSize, currentPage * pageSize - 1)) {
            term.clearLine();
            print(lines[i] ?? "");
        }
        const nextPageInt = tonumber(getInput(`Page ${currentPage} of ${totalPages} - Enter page number: `));
        // NaN check / increment
        currentPage = nextPageInt ?? currentPage + 1;
    }
}
/**
 * This function should be repeatedly called with its return values.
 * It will set the fifth return value to true when the input is complete.
 * The most recently pulled event is returned for other use.
 * It is similar in use to the default settings of readline(3), providing basic editing and navigation to a user.
 * @param prompt The prompt to show the user before gathering input.
 * @param prevInput The previous input string the function gave.
 * @param heldKeys The currently held modifier keys, as returned.
 * @param pointer The location of the cursor.
 * @returns [{@link prevInput}, {@link heldKeys}, {@link pointer}, event, done ]
 */
const readCharacter = (prompt: string, prevInput: string, heldKeys: { ctrl: boolean }, pointer: number) => {
    prevInput = prevInput ?? "";
    heldKeys = heldKeys ?? { ctrl: false };
    pointer = pointer ?? 0;
    term.clearLine();
    const [_, y] = term.getCursorPos();
    term.setCursorPos(1, y);
    write(`${prompt}${prevInput}`);
    term.setCursorPos(prompt.length + 1 + pointer, y);
    const event = os.pullEvent();
    // handle text input
    const ctrlCommands = {
        // move to start
        a: () => { pointer = 0 },
        // move back 1 char
        b: () => { pointer -= 1 },
        // delete current char
        d: () => { prevInput = string.sub(prevInput, 1, pointer) + string.sub(prevInput, pointer + 2) },
        // move to end
        e: () => { pointer = prevInput.length },
        // move forward one char
        f: () => { pointer += 1 },
        // delete previous char
        h: () => {
            prevInput = string.sub(prevInput, 1, pointer - 1) + string.sub(prevInput, pointer + 1);
            pointer -= 1;
        },
        // clear string, pointer onwards
        k: () => { prevInput = string.sub(prevInput, 1, pointer) },
        // swap prev + current char
        t: () => {
            if (pointer === prevInput.length) pointer--;
            const start = string.sub(prevInput, 1, pointer - 1);
            const charSwapOne = string.sub(prevInput, pointer, pointer);
            const charSwapTwo = string.sub(prevInput, pointer + 1, pointer + 1);
            const sEnd = string.sub(prevInput, pointer + 2);
            prevInput = start + charSwapTwo + charSwapOne + sEnd;
            pointer += 1;
        },
        // clear string to pointer
        u: () => {
            prevInput = string.sub(prevInput, pointer + 1);
            pointer = 0;
        }
    } as { [index: string]: undefined | (() => void) }
    const keyToCommand = {
        [keys.home]: ctrlCommands.a,
        [keys.left]: ctrlCommands.b,
        [keys.delete]: ctrlCommands.d,
        [keys.end]: ctrlCommands.e,
        [keys.right]: ctrlCommands.f,
        [keys.backspace]: ctrlCommands.h
    }
    if (event[0] === "char") {
        prevInput = string.sub(prevInput, 1, pointer) + event[1] + string.sub(prevInput, pointer + 1);
        pointer += 1;
    // handle enter, ctrl, movement, delete
    } else if (event[0] === "key") {
        const key = event[1];
        if (key === keys.leftCtrl || key === keys.rightCtrl) {
            heldKeys.ctrl = true;
        } else if (key === keys.enter || key === keys.numPadEnter) {
            return $multi(prevInput, heldKeys, pointer, event, true);
        } else if (heldKeys.ctrl) {
            const name = keys.getName(key);
            pcall(ctrlCommands[name]);
        } else if (keyToCommand[key] !== undefined) keyToCommand[key]();
    } else if (event[0] === "key_up") {
        if (event[1] === keys.leftCtrl || event[1] === keys.rightCtrl) heldKeys.ctrl = false;
    }
    pointer = math.min(math.max(0, pointer), prevInput.length);
    return $multi(prevInput, heldKeys, pointer, event, false);
}
/**
 * Get an input from the user, with access to the key events produced.
 * Uses {@link readCharacter} to provide navigation and editing tools to the user.
 * Maintains reasonable interface compatibility with {@link https://tweaked.cc/module/_G.html#v:read}.
 * @param prompt The prompt to show the user when gathering input.
 * @param func An optional callback function that will be called with the current input and event.
 * @returns The input the user gave.
 */
export const readline = (prompt: string, func?: (partial: string, event?: LuaMultiReturn<[string, ...unknown[]]>) => void) => {
    func = func ?? (() => {});
    const cursorState = term.getCursorBlink();
    term.setCursorBlink(true);
    let prevInput = "";
    let heldKeys: { ctrl: boolean };
    let pointer: number;
    let event: LuaMultiReturn<[string, ...unknown[]]>;
    let done: boolean;
    do {
        [prevInput, heldKeys, pointer, event, done] = readCharacter(prompt, prevInput, heldKeys, pointer);
        func(prevInput, event);
    } while (!done);
    term.setCursorBlink(cursorState);
    write("\n");
    return prevInput;
}
/**
 * Finds strings that contain the query in the search space.
 * @param searchSpace A string array to search within for query matches.
 * @param query The query to find within each string in the given array.
 * @returns The matching values.
 */
export const stringSearch = (searchSpace: LuaSet<string>, query: string): string[] => {
    const matches = [];
    const queryRegex = `.*${query}.*`;
    for (const haystack of searchSpace)
        if (string.find(haystack, queryRegex)[0] !== undefined)
            matches.push(haystack);
    return matches;
}
/**
 * Allow a user to search a large amount of text at their own pace.
 * @param lines The strings to search through.
 * @param height The maximum amount of strings to display at once.
 */
export const displaySearch = (lines: LuaSet<string>, fullscreen: boolean = true) => {
    let y = 1;
    if (!fullscreen) y = term.getCursorPos()[1];
    const height = term.getSize()[1] - y + 1;
    let offset = 0;
    const callback = (partial: string, event?: LuaMultiReturn<[string, ...unknown[]]>) => {
        const matchingLines = stringSearch(lines, partial);
        while (matchingLines[offset] === undefined && offset !== 0) offset--;
        if (event !== undefined && event[0] === "key") {
            // TODO: page up/down support
            if (event[1] === keys.down && matchingLines[height + offset + 1] !== undefined) offset++;
            if (event[1] === keys.up && matchingLines[offset - 1] !== undefined) offset--;
        }
        term.setCursorPos(1, y);
        for (const i of $range(0, height - 2)) {
            term.clearLine()
            print(matchingLines[i + offset] ?? "");
        }
    }
    callback("");
    readline("Enter search query: ", callback);
}
/**
 * @param value The string to find the suffix of.
 * @param suffix The desired suffix.
 * @returns Whether the string ends in the given suffix.
 */
export const endsWith = (value: string, suffix: string) => string.sub(value, -suffix.length) === suffix;
/**
 * Progress bar to visually guide user about the progress of a running operation.
 */
export class ProgressBar {
    _x: number;
    _y: number;
    _length: number;
    /**
     * Create a new progress bar from the current cursor position to the edge of the screen.
     * @param progress A number from 0 to 1 representing the progress of the bar.
     */
    constructor(progress?: number) {
        // get start of bar
        const pos = term.getCursorPos();
        [this._x, this._y] = pos;
        const [width] = term.getSize();
        // set length to edge of screen
        this._length = width - this._x;
        // set progress / draw empty bar
        this.setProgress(progress ?? 0);
        write("\n");
    }

    /**
     * Update the drawn bar to the new progress value.
     * @param progress A number from 0 to 1 representing the progress of the bar.
     */
    setProgress(progress: number) {
        progress = math.min(math.max(0, progress), 1);
        const [prevCursorX, prevCursorY] = term.getCursorPos();
        // account for brackets in bar display
        const barSize = this._length - 2;
        const filled = math.floor(barSize * progress);
        const filledString = "*".repeat(filled) + " ".repeat(barSize - filled);
        term.setCursorPos(this._x, this._y);
        write(`[${filledString}]`);
        term.setCursorPos(prevCursorX, prevCursorY);
    }
}
