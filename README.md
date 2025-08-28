# CASTLR
ComputerCraft: Tweaked program written in TypeScript. Uses [TypeScriptToLua](https://typescripttolua.github.io) to compile with ComputerCraft typing declarations.

## Usage
1. Clone the repository (or download the ZIP).
2. Run `npm install` to install dependencies, including TypeScriptToLua.
3. Build the project with `npm run build`.
4. Copy `main.lua` to ComputerCraft, either by copying into the computer folder, dropping on the terminal, using Pastebin, or with [CraftOS-PC Remote](https://remote.craftos-pc.cc) or [cloud-catcher](https://cloud-catcher.squiddev.cc).
5. See docs/install.md for post-install instructions.

## Libraries

In ./lib/*.ts, several utilities can be found:
* inventory.ts  
    This is responsible for wrapping generic 'inventory' peripherals, adding a cache system to prevent frequent calls to the game itself.
* data.ts  
    This is resposible for loading and using recipe data for CASTLR. It additionally has the responsibility of initalising storage data, due to its reliance on recipe data.
* expressions.ts  
    This is responsible for the parsing, evaluation and validiation of basic mathematical operations.
* storage.ts  
    This is responsible for managing a group of connected inventories, providing methods for aggregating data, and transferring items within managed inventories.
* utils.ts  
    This is responsible for basic file I/O and all UI elements.

### Built-in CraftOS APIs
All base CraftOS APIs are available in the global namespace.
Peripherals are also implemented as classes that inherit from the `IPeripheral` interface, so you can call `wrap` and cast it to the desired class to get typings for the peripheral.

### `cc.*` Modules
All modules available in `/rom/modules/main/cc` have typings included. To import them, just use the `import` statement like normal:
```ts
import * as strings from "cc.strings";
// ...
let str = strings.ensure_width(arg, 20);
```

## Contributing
All contributions are expected to be well documented and limited in scope.

## License
The typings in `types/` and `event.ts` are licensed under the MIT license. Projects are free to use these files as provisioned under the license (i.e. do whatever you want, but include the license notice somewhere in your project). Anything else is public domain.
