import { intValidator } from "./utils";

type Token = number | string;
type Operator = {
    func: (num1: number, num2: number) => number
    precedence: number
}
/**
 * A mapping of operator characters to functions and their precendences.
 */
const operators = {
    "+": {
        func: (num1, num2) => num1 + num2,
        precedence: 0,
    },
    "*": {
        func: (num1, num2) => num1 * num2,
        precedence: 1,
    },
    "/": {
        func: (num1, num2) => num1 / num2,
        precedence: 1,
    },
    "-": {
        func: (num1, num2) => num1 - num2,
        precedence: 0,
    },
} as { [key: string]: Operator }

/**
 * Function to convert an expression into an array of tokens.
 * It accepts simple expressions, consisting of numbers and operators
 * @param expr The mathematical expression to tokenise.
 * @returns An array of tokens.
*/
const tokeniser = (expr: string): (number | string)[] => {
    let buffer = "";
    const tokens = [];

    for (const i of $range(1, expr.length + 1)) {
        const char = string.sub(expr, i, i)
        if (char === "=") break;
        // number test
        if (string.find(char, "[0-9\.]")[0] !== undefined) {
            buffer += char;
        // operator test
        } if (string.find(char, "[+*/\-]")[0] !== undefined) {
            tokens.push(tonumber(buffer));
            buffer = "";
            tokens.push(char);
        }
    }
    if (buffer.length !== 0) tokens.push(tonumber(buffer));
    return tokens;
}
/**
 * Function implementing part of the shunting yard algorithm to convert infix to postfix expressions.
 * There is no support for bracketing.
 * @param tokens An array of tokens using infix notation, as produced by {@link tokeniser}
 * @returns An equivalent array, using postfix notation
 */
const convertToPostfix = (tokens: Token[]): Token[] => {
    const outputQueue: Token[] = [];
    const operatorStack: Token[] = [];
    for (const token of tokens) {
        if (typeof token === 'number') {
            outputQueue.push(token);
        } else if (operators[token]) {
            // operator
            while (
                operatorStack.length !== 0 && 
                operators[token].precedence <= operators[operatorStack[operatorStack.length - 1]].precedence
            ) outputQueue.push(operatorStack.pop());
            operatorStack.push(token);
        }
    }
    for (const operator of operatorStack) outputQueue.push(operator);
    return outputQueue;
}
/**
 * Function to evaluate a mathematical expression as a string.
 * @param expr The mathematical expression to parse.
 * @returns The value of the evaluated expression, or undefined.
 */
export const expressionEvaluator = (expr: string): number | undefined => {
    const tokens = tokeniser(expr);
    const postfixTokens = convertToPostfix(tokens);
    // for (const token of postfixTokens) write(token.toString() + ", ");
    const operatingStack: number[] = [];
    for (const token of postfixTokens) {
        if (typeof token === 'number') {
            operatingStack.push(token);
        } else if (operators[token] !== undefined) {
            const num2 = operatingStack.pop();
            const num1 = operatingStack.pop();
            if (num1 === undefined || num2 === undefined) return;
            operatingStack.push(operators[token].func(num1, num2));
        }
    }
    return operatingStack.pop();
}
/**
 * Get a function to validate an expression, and ensure its result is within bounds.
 * @param min The minimum allowed value for an expression to evaluate to.
 * @param max The maximum allowed value for an expression to evaluate to.
 * @returns A function to validate expressions within the bounds.
 */
export const expressionValidator = (min: number, max: number) => {
    /** @noSelf */
    return (expr: string): boolean => {
        const value = expressionEvaluator(expr)
        return value !== undefined && intValidator(min, max)(value as unknown as string);
    }
}
/**
 * An autocompletion function for expressions, conveying its evalutated value.
 * Compatible with {@link correctableInput}.
 * @noSelf
 * @param partial The partial expression to complete.
 * @returns An autocompletion string.
 */
export const expressionCompletor = (partial: string) => {
    const value = expressionEvaluator(partial);
    if (string.find(partial, "=")[0] !== undefined || value === undefined) return [];
    return [" = " + value];
}