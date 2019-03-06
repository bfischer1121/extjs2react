# ExtJS → React [Native]

## Summary
The goal of ExtJS2React (e2r) is migrate ExtJS applications to React [Native] by rewriting their entire codebase. Much of the work will be automated while an ever-shrinking set of cases will be left for manual intervention. This is an unofficial library in no way associated with Sencha. Use at your own risk.

## Preparing Your ExtJS Project
For speed of development and depth of implementation, it is currently assumed that the source project is ExtJS 6.x with MVVM architecture. If your project isn't there but you want to use this tool, migrate to the common starting point and then run this tool to cross the bridge to React-land:
* Sencha Touch → ExtJS
* <6.x → 6.x
* MVC → MVVM

## Getting Started
* Clone the repo
* Open `/config.json` and modify the params accordingly
* Open the terminal and go to the extjs2react directory, run `npm install`
* Run `npm start`
* Say a little prayer

## ES6 Class Names
ExtJS classes are namespaced while, with modules, ES6 class names are generally not. To make the transition, e2r uses the xtype or alias of your ExtJS class as the ES6 class name. To convert lowercase xtypes to properly-cased class names, we need to distinguish words. To this end, e2r builds a word list from the class names and namespaces used within your codebase and the ExtJS framework. While this works fairly well, it requires some manual tuning:

* Run `npm run classnames` in the extjs2react directory
* Go through this list of all of your classes and add mis-capitalized words to the `words` array in `/config.json`
* Rinse and repeat until the class names look good
* Note: if a word has no effect, use a larger portion of the class name (longer words take precedence and yours may have been overriden)

e.g., `FaceidSetup` → add `FaceID` to config → `FaceIDSetup` (if no effect, add `FaceIDSetup`)

## Progress
##### Architectural - generally non-breaking:
- [x] `import` statements for fully-qualified class dependencies
- [x] `import` statements for aliases
- [ ] ExtJS classes → ES6 classes
- [x] `items` → JSX within render
- [ ] ViewModel → `state`, render
- [ ] ViewController → Component methods, `props`, render
- [ ] Utility methods → ES6, lodash
##### Component (Optional) - generally break associated code, requiring manual fixing
- [ ] Small subset of Components → open source libraries (w/ documented api loss)
  - [ ] Layouts (flexbox-compatible)
  - [ ] Panel, Container, Component
  - [ ] Button
  - [ ] Form Fields
  - [ ] DataView
- [ ] Data Package (w/ documented api loss)
  - [ ] Stores
  - [ ] Models
  - [ ] Proxies

## Need Help?
If your company is migrating an ExtJS app to React (or other framework) and would like some help, feel free to email me at my github username (looks like bfis----1121) at gmail.com
