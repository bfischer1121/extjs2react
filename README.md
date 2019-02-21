# (ExtJS | Sencha Touch) → React

## Summary
The goal of this project is to migrate ExtJS (and Sencha Touch) applications over to React. It does this by rewriting existing ExtJS code into React code. The goal is not perfection, but to eliminate the vast majority of the work while leaving an ever-shrinking set of cases for human intervention. This is an unofficial library in no way associated with Sencha. Use at your own risk.

## Preparing Your ExtJS Project
For speed of development and depth of implementation, it is currently assumed that the source project is ExtJS 6.x with MVVM architecture. If your project isn't there but you want to use this tool, migrate to the common starting point and then run this tool to cross the bridge to React-land:
* Sencha Touch → ExtJS
* <6.x → 6.x
* MVC → MVVM

## Getting Started
* Clone the repo
* Open `/config.json` and modify `sourceDir` to point to your ExtJS project
* Open the terminal and go to the extjs2react directory, run `npm install`
* Run `npm start`
* Say a little prayer

## Progress - architectural transpilations that will generally not break your code
- [x] `import` statements for fully-qualified class dependencies
- [ ] `import` statements for xtypes
- [ ] ExtJS classes → ES6 classes
- [ ] `items` → JSX within render
- [ ] ViewModel → `state`, render
- [ ] ViewController → Component methods, `props`, render
- [ ] Utility methods → ES6, Underscore

## Progress - optional migrations that will break some associated code
- [ ] Small subset of Components → Bootstrap and others (w/ documented api loss)
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
If your company migrating an ExtJS app to React (or other framework) and you could use some help, feel free to email me at my github username (looks like bfis----1121) at gmail.com
