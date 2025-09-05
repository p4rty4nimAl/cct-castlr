# Usage
## Installation
After moving the lua file to the desired computer, the installation may proceed by executing the file. On the first execution in a new environment, a few settings are defined.

1. `castlr.inputChest`  
    This setting defines the string used to identify the chest used as input inventory for the CASTLR system.
2. `castlr.outputChest`  
    This setting defines the string used to identify the chest used as output inventory for the CASTLR system.
3. `castlr.period`  
    This setting controls the amount of time, in seconds, between each user operation.
4. `castlr.version`  
    This setting controls the version of CASTLR. If left at the default value, CASTLR will automatically update.  
    Automatic updates can be disabled by setting this to a specific value ('v1.0.0'), pinning the version.

The above settings cannot be set from within CASTLR, and instead must be configured with the `set` program, for example: `set castlr.period 1`.

## CASTLR

Note: All connected inventories must be on the same wired network.
There must be a direct path between two inventories that does not go through the controlling computer, else items cannot be transferred.

### Crafting
Crafting is the main responsibility of CASTLR, using user-defined recipes to craft items in bulk.
To craft an item, it must have a defined recipe.
To begin crafting, the ID of the item to craft, alongside an amount must be entered. The amount to craft can be a mathematical expression, such as `8 * 64`.

**Recipe Resolution**  
Resolution works recursively to build a crafting tree.
Items already stored will be used first, crafting more only as necessary.
If there is not enough of any one input item for that recipe, it is resolved by marking the deficit to be crafted, given there is an available recipe for that item.

This happens until all items are accounted for.
If any item is required to be inserted, you will be shown which items and how much.

However, if all items are craftable or available, crafting will proceed when the prompt is accepted.

### Adding
Adding recipes is how you can tell CASTLR what it can create.
To add a recipe, you must first define a recipe type.

**Types**  
A recipe type consists of a unique identifier, as well as an input and output chest. 
The unique identifier must be in the form `<namespace>:<process>`, and as such is best modelled after the recipe type it processes, as seen in recipe viewers. 
For example: `minecraft:crafting`.  
The input and output chests are identified by the string given when attaching them to a wired modem. 
The input chest is where items shall be sent to craft a recipe using the new type, whereas the output chest is the one that is checked for the crafted item.
These chests are expected to be different.

**Recipes**  
A recipe is defined by a recipe type (see above).
This information is used to determine how to perform the recipe.
Items are referred to using their in-game ID, which can be found by enabling advanced tooltips: `F3 + H`.  
The next part of the definition is the item that the recipe produces.
The ID, and amount of the item that is produced must be provided.
The ID must be unique, such that there is only one way to make a given item.  
The final part of the definition of a recipe is the items required to craft the given output.
When asked for the input count, enter the number of unique items.
You should then proceed to enter the details of the input items, as requested.

### Storing
Storing items will take everything the CASTLR input chest, and insert it into storage inventories.
Additionally, there is the option of storing items currently in recipe outputs.
If this option is selected, all items in all outputs are first moved to the CASTLR input chest, after which they are then inserted.

### Taking
Taking allows for removal of a specific amount of a single item from the CASTLR storage.
First, you will be asked for the item ID you would like to take.
You will then be asked for the amount to take.
This must be a number between zero and the amount stored.
Once a number has been entered, the items will be moved to the CASTLR output chest, from where it can then be taken and used as you wish.


### Listing
Listing allows for an overview over what items are stored in CASTLR.
The menu can be scrolled using the up and down arrow keys, and can be searched by typing a query.
There is a line editor, implementing a subset of `readline`.
The commands implemented can be accessed by holding control, denoted with `C-`, then pressing the indicated key:
* C-a: moves the cursor to the start of the line (alias for *home*).
* C-b: moves the cursor back one character (alias for *left arrow*).
* C-d: deletes the character at the current cursor location (alias for *delete*).
* C-e: moves the cursor to the end of the line (alias for *end*).
* C-f: moves the cursor forward one character (alias for *right arrow*).
* C-h: deletes the character behind the current cursor location (alias for *backspace*).
* C-k: deletes all characters in front of the cursor, including the character at the cursor.
* C-t: swaps the character behind the cursor and the character at the cursor, moving it forward.
* C-u: deletes all characters behind the cursor.

### Refreshing
Refreshing the system is functionally identical to closing CASTLR, then restarting it.
A system refresh is only required under the following circumstances:
* An item has been taken or inserted into storage without using the [Take](#taking) or [Store](#storing) menu option.
* A recipe or recipe type has been edited, and must loaded before use.

## Advanced Usage
### Recipe editing
It is possible to make mistakes when creating recipes or recipe types.
If simply re-adding the recipe/type is not feasible, it can be edited directly using the `edit` program.
It is expected that those trying to edit recipes/types are familiar with JSON, or that they use a JSON validator before refreshing CASTLR.

Types are stored next to the program, in `./types/`. All types are stored as JSON, and the format must be preserved.
If a type is rendered invalid, its associated recipes will not be loaded.

Recipes are stored next to the program, in `./recipes/<type>/`.
As with types, all recipes are stored as JSON, and their formats must also be preserved.

**Issues**
* "Recipe type must be declared before adding a recipe using it."
  - To resolve this, the recipe definition must be removed. The recipe type it intends to use should then be added, and the recipe can be re-defined. 
* "Recipes with outputs matching another are not allowed."
  - Of the two recipe definitions shown, one must be deleted.
* "Missing input or output chest."
  - The recipe type definition must be `edit`ed to insert the "input" or "output" tag.
* "Recipe types with types matching another are not allowed."
  - Of the two recipe type definitions shown, one must be deleted.
* "Invalid JSON structure."
  - The definition file specified cannot be read by CASTLR, and must either be made valid, or deleted.

### Automated Farms
Automated farms can be integrated into CASTLR, without it using the farm output as storage.
By adding a new recipe type (namespaced with `special` to avoid naming conflicts), with a blank input chest, the output chest of the farm will be pulled from, but never pushed to.

### Awkward Recipes
Due to CASTLR's lack of representation of gaps in recipes, some recipes are awkward to automate, such as pickaxes.
To craft such items, a manual recipe type can be created.
Setting the recipe input as the CASTLR output chest, and the recipe output as the CASTLR input chest (or another pair of chests), items will be provided for manual crafting.
By using the CASTLR input/output chests, existing usage is reinforced.
I recommend identifying this recipe type with `special:human_input`.

Note: there will be no notification from CASTLR that the current recipe is manual. 

### Automatic Execution
After installation it may be desired to run the program on every restart of the computer.
To achieve this, I recommend creating a separate `startup.lua` file, with contents similar to below.
```lua
shell.run("fg monitor monitor_0 castlr.lua")
```
Using `fg` in this way will run CASTLR in a separate shell, allowing for other shells with which to use the computer.
`monitor` is also useful for displaying the text output of CASTLR on an external display.  
On 'basic' systems, `fg` is not available.  
If no external monitor is connected, `monitor` cannot be used.