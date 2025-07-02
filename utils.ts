export const writeFile = (path: string, data: string) => {
    const file = fs.open(path, "w")[0];
    file.write(data);
    file.close();
}
export const readFile = (path: string) => {
    const file = fs.open(path, "r")[0];
    const data = file.readAll();
    file.close();
    return data;
}
type InputOptions = {
    replaceChar?: string,
    history?: string[],
    completeFn?: (this: void, partial: string) => string[],
    presetInput?: string
}
export const input = (prompt: string, options: InputOptions = {}) => {
    write(prompt);
    return read(options.replaceChar, options.history, options.completeFn, options.presetInput);
}
export const splitString = (value: string, separator: string = ":") => {
    const splitStrings = [];
    let buffer = "";
    while (value.length !== 0) {
        if (string.sub(value, 0, separator.length) === separator) {
            splitStrings.push(buffer);
            value = string.sub(value, separator.length);
            buffer = "";
        }
        buffer += string.sub(value, 1, 1);
        value = string.sub(value, 2);
    }
    splitStrings.push(buffer);
    return splitStrings;
}
export const intValidator = (min: number, max: number) => (int: string) => min <= tonumber(int) && tonumber(int) <= max;

export const namespaceValidator = (string: string) => splitString(string).length === 2;

export const orderStrings = (uniqueStrings: LuaSet<string>): string[] => {
    // order item names for efficient searching
    // - not including this breaks autocompletion algorithm
    const orderedStrings: string[] = [];
    for (const val of uniqueStrings)
        orderedStrings.push(val);
    table.sort(orderedStrings);
    return orderedStrings;
}

export const stringCompletor = (orderedAllowedValues: string[]) => {
    /** @noSelf **/
    // - TODO: autocomplete alg binary search
    return (partial: string) => {
        const completeValues: string[] = [];
        // if no input, return all.
        if (partial.length === 0) return orderedAllowedValues;
        for (const i of $range(0, orderedAllowedValues.length - 1)) {
            if (string.sub(orderedAllowedValues[i], 0, partial.length) === partial) {
                completeValues.push(string.sub(orderedAllowedValues[i], partial.length + 1));
            // if any items already allowed and current value isnt, no further values will be allowed
            // as allowed values is sorted - can early exit
            } else if (completeValues.length !== 0) return completeValues;
        }
        return completeValues;
    }
}

export const correctableInput = (strings: string[], conditions: (((maybeValid: string) => boolean) | undefined)[] = [], completeFns: (((this: void, partial: string) => string[]) | undefined)[]): LuaMultiReturn<string[]> => {
    const defaultValues: string[] = [];
    let correct = "N";
    while (correct !== "Y") {
        let i = 0;
        while (i < strings.length) {
            // formatting
            const newValue = input(`Enter - ${strings[i]}\: `, { presetInput: defaultValues[i], completeFn: completeFns[i] });
            // validation - we can: accept new input, retry new input
            if (conditions[i] === undefined || conditions[i](newValue)) {
                // accept new input
                defaultValues[i] = newValue;
                i++;
            } // else retry
        }
        correct = input("Is the above correct? (Y/N): ");
    }
    return $multi(...defaultValues);
}
export const menu = (displayText: string[]): string => {
    for (const i of $range(0, displayText.length - 2))
        print(displayText[i]);
    return input(displayText[displayText.length - 1]);
}
export const paginator = (lines: string[], height: number = term.getSize()[1], ) => {
    const pageSize = height - 2;
    const totalPages = Math.ceil(lines.length / pageSize);
    let currentPage = 0;
    let running = true;
    while (running) {
        for (const i of $range(currentPage * pageSize, (currentPage + 1) * pageSize - 1))
            if (lines[i] !== undefined)
                print(lines[i]);
        const nextPageInt = tonumber(input(`Page ${currentPage + 1} of ${totalPages} - Enter page number: `));
        // NaN check
        if (nextPageInt !== undefined) {
            currentPage = nextPageInt - 1;
        } else currentPage++;
        if (currentPage >= totalPages) running = false;
    }
}
export const endsWith = (value: string, suffix: string) => string.sub(value, -suffix.length) === suffix;