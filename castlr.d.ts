declare const enum StorageType {
    Input, Output, Storage, NotInput
}
/** @noSelf */
declare class KeyboardPeripheral implements IPeripheral {
    setFireNativeEvents(fire: boolean): void;
}
type RecipeTypeIdentifier = string;
type RecipeLocation = string;
type RecipeType = {
    typeID: RecipeTypeIdentifier
    input: RecipeLocation
    output: RecipeLocation
}
type Recipe = {
    typeID: RecipeTypeIdentifier
    input: SlotDetail[]
    output: SlotDetail
}
type Settings = {
    period: number
    inputChest: RecipeLocation
    outputChest: RecipeLocation
}

// map of index to count
type SlotCounts = LuaMap<number, number>;