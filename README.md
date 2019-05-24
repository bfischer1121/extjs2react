# ExtJS → React [Native] + Redux + Blueprint

## Summary
ExtJS2React (e2r) migrates ExtJS applications to React [Native] + Redux + Blueprint by rewriting their entire codebase. Much of the work is automated while an ever-shrinking set of cases are left for manual intervention. This is an unofficial library in no way associated with Sencha. Use at your own risk.

## Preparing Your Project
For speed of development and depth of implementation, it is currently assumed that the source project is ExtJS 6.x with MVVM architecture. If your project isn't there but you want to use this tool, migrate to the common starting point and then run this tool to cross the bridge to React-land: `Sencha Touch → ExtJS` `<6.x → 6.x` `MVC → MVVM`

## Getting Started
* Clone the repo
* Open `/config.json` and modify the params accordingly
* Run `npm install` in the extjs2react directory
* Run `npm start`
* ...
* Profit!

## Progress
### General Modernization
- [x] `var` → `let` when at root of function (config: `varToLet`)
- [x] `function` → arrow function when not using `this` or `arguments` (config: `arrowFunctions`)
- [x] `me` → `this` when redundant (config: `arrowFunctions`)
- [x] `() => { return ... }` → `() => ...` (config: `arrowReturnShorthand`)
- [x] `() => { ... }` → `() => ...` (config: `arrowExpressionShorthand`)
- [x] `getCount() + ' widgets'` → ``${getCount()} widgets`` (config: `templateLiterals`)
### Architecture
- [x] ClassManager → ES6 modules
  - [x] namespaced class names → simple names & references
  - [x] import class dependencies
  - [x] import alias dependencies
  - [x] exports
  - [x] name collision avoidance
  - [x] resolve alternateClassName to primary
  - [x] reactify all framework components w/ manifest
- [ ] ExtJS classes → ES6 classes
  - [x] extends → `extend`
  - [x] statics → `static`
  - [x] singleton → `export` instance
  - [x] config/cachedConfig/eventedConfig → ES6 accessors & calls
  - [x] mixins → inline js (Object.assign)
  - [ ] plugins
- [x] Component
  - [x] properties → local variables
  - [x] configs
    - [x] definition
      - [x] default values → merged `props` object
      - [x] apply* → `useMemo` prop reassignment
      - [x] update* → `useEffect`
    - [x] assignment
      - [x] declarative → JSX
      - [ ] procedural (set*)
    - [ ] reference (get*)
      - [x] inside component → `props.*`
      - [ ] outside component
  - [x] methods → inline functions
    - [x] initialize → useEffect(..., [])
    - [ ] this.* references
      - [x] local class members → local scope
      - [ ] inherited class members → JSX ExtJS component
    - [ ] .lookup → React `reference`
- [ ] ViewController
  - [x] properties/configs/methods → Component
  - [x] .getView() | .view → this
  - [x] variables referencing Component → this
  - [ ] transform lifecycle methods
- [ ] ViewModel → `state`, render
### Component Library
- [ ] Ext
  - [ ] .dataview
    - [ ] .DataView
    - [ ] .List
  - [ ] .field
    - [ ] .Checkbox → [Checkbox](https://blueprintjs.com/docs/#core/components/checkbox)
    - [x] .File → [FileInput](https://blueprintjs.com/docs/#core/components/file-input)
    - [ ] .Hidden → Hidden input
    - [ ] .Number
    - [ ] .Radio → [Radio](https://blueprintjs.com/docs/#core/components/radio)
    - [ ] .Select → [Select](https://blueprintjs.com/docs/#select/select-component)
    - [x] .Text → [HTML input](https://blueprintjs.com/docs/#core/components/text-inputs.html-input)
    - [x] .TextArea → [Text area](https://blueprintjs.com/docs/#core/components/text-inputs.text-area)
    - [x] .Toggle → [Switch](https://blueprintjs.com/docs/#core/components/switch)
  - [ ] .form
    - [ ] .FieldSet
  - [ ] .layout
    - [ ] .Card
  - [x] .Button → [Button](https://blueprintjs.com/docs/#core/components/button)
    - [x] `onTap` → `onClick`
  - [x] .Component → div
    - [x] `html` → child
  - [x] .Container → div
    - [x] `items` → children
  - [x] .Panel → div
### Data Package
- [ ] Stores
- [ ] Models
  - [x] `.get('foo')` → `.foo`
  - [x] `foo.set(fieldOrObject[, value])` → `modifyRecord(foo, fieldOrObject[, value])` action
  - [ ] .getData
  - [ ] .isModel
- [ ] Proxies
### Standard Library
- [ ] Ext
  - [ ] .Ajax
    - [ ] .getDefaultHeaders
    - [ ] .on
    - [ ] .request
  - [ ] .Array
    - [x] .clean → _.compact
    - [ ] .clone
    - [x] .each → Array.forEach
    - [x] .contains → Array.includes
    - [x] .difference → _.difference
    - [x] .flatten → _.flattenDeep
    - [x] .indexOf → Array.indexOf
    - [x] .intersect → _.intersection
    - [x] .map → Array.map
    - [x] .pluck → _.map
    - [x] .remove → _.pull
    - [ ] .slice
    - [ ] .sort
    - [ ] .toArray
    - [x] .unique → _.uniq
  - [ ] .browser
    - [ ] .browser
      - [ ] .name
      - [ ] .version.version
    - [ ] .is
      - [ ] .AndroidStock2
      - [ ] .WebView
  - [ ] .Date
    - [ ] .add
    - [ ] .between
    - [ ] .clearTime
    - [ ] .diff
    - [ ] .format
    - [ ] .getShortDayName
    - [ ] .getShortMonthName
    - [ ] .parse
    - [ ] .DAY
    - [ ] .MINUTE
    - [ ] .monthNames
  - [ ] .DomQuery
    - [ ] .is
  - [ ] .Function
    - [x] .bind → Function.bind
    - [ ] .createBuffered
    - [ ] .createSequence
    - [ ] .createThrottled
    - [ ] .interceptBefore
  - [x] .JSON
    - [x] .decode → JSON.parse
    - [x] .encode → JSON.stringify
  - [ ] .Number
    - [x] .constrain → _.clamp
    - [ ] .from
    - [x] .toFixed → Number.toFixed
  - [ ] .Object
    - [x] .each → _.forEach
    - [x] .getSize → Object.keys(...).length
    - [ ] .merge
  - [ ] .String
    - [x] .capitalize → _.upperFirst
    - [ ] .escapeRegex
    - [ ] .htmlEncode
    - [x] .leftPad → String.padStart
    - [ ] .repeat
    - [x] .trim → String.trim
    - [ ] .trimRegex
  - [ ] .Template → JSX
    - [x] Member functions
    - [ ] Dynamically-determined template substrings
    - [x] {...}
      - [x] {(field|.):(fn|this.fn)(...)} → {(Ext.util.Format|helper).fn((field|data), ...)}
    - [ ] {[ ... ]}
      - [x] values
      - [ ] out
      - [ ] parent
      - [ ] xindex
      - [ ] xcount
      - [ ] xkey
    - [ ] {% ... %}
    - [x] tpl if
    - [ ] tpl elseif
    - [ ] tpl else
    - [ ] tpl for
  - [ ] .util
    - [ ] .Format
      - [ ] .date
      - [ ] .htmlEncode (see Ext.String.htmlEncode)
    - [ ] .Inflector
      - [ ] .plural
      - [ ] .pluralize
      - [ ] .singular
  - [x] .apply → Object.assign
  - [x] .applyIf → _.assignWith
  - [x] .baseCSSPrefix → 'x-'
  - [x] .bind (see Ext.Function.bind)
  - [x] .clone → _.cloneDeep
  - [x] .defer → setTimeout
  - [ ] .Deferred
    - [ ] self
    - [ ] .rejected
  - [x] .emptyFn → () => {}
  - [x] .encode (see Ext.JSON.encode)
  - [x] .isArray → _.isArray
  - [x] .isDate → _.isDate
  - [x] .isDefined → !_.isUndefined
  - [x] .isEmpty → _.isEmpty
  - [x] .isFunction → _.isFunction
  - [x] .isNumber → _.isFinite
  - [x] .isNumeric → _.isFinite(+...)
  - [ ] .isObject
  - [x] .isString → _.isString
  - [ ] .Promise
  - [ ] .toArray

## Manual Tuning
### ES6 Class Names
ExtJS classes are namespaced while, with modules, ES6 class names are generally not. To make the transition, e2r uses the xtype or alias of your ExtJS class as the ES6 class name. To convert lowercase xtypes to properly-cased class names, we need to distinguish words. To this end, e2r builds a word list from the class names and namespaces used within your codebase and the ExtJS framework. While this works fairly well, it requires some manual tuning:

* Run `npm run classnames` in the extjs2react directory
* Go through this list of all of your classes and add mis-capitalized words to the `words` array in `/config.json`
* Rinse and repeat until the class names look good
* Note: if a word has no effect, use a larger portion of the class name (longer words take precedence and yours may have been overriden)

e.g., `FaceidSetup` → add `FaceID` to config → `FaceIDSetup` (if no effect, add `FaceIDSetup`)

### ES6 Modules
ExtJS dependency management is global, while ES6 dependencies are local. To make the transition, e2r builds a registry of all class names and aliases, determines each source file's requirements, and adds corresponding `import` and `export` statements. 

This modularization can lead to circular dependencies. In webpack, the imported class will become undefined and, if extended, will produce the following error:
`Unhandled Rejection (TypeError): Super expression must either be null or a function`

To resolve these issues, I recommend using a tool like [circular-dependency-plugin](https://github.com/aackerman/circular-dependency-plugin) and refactoring the original code as needed.

### Dynamic Classes
Since e2r does a static code analysis, it isn't able to pick up on dynamically generated `Ext.define` calls. If you are dynamically creating ExtJS Classes and want to ensure these class definitions are properly imported and referenced throughout, add a comment to the file like so:
```javascript
/**
 * Classes:
 * MyApp.model.Foo
 * MyApp.model.Bar
 * MyApp.user.List
 */
```

e2r will then add placeholder ES6 classes to the file's generated output. You can of course safely remove these as long as you export classes of the same names.

### XTemplate → JSX
When compiling templates, ExtJS wraps `tpl` conditional statements in native `with(values)` blocks. This adds `values` to the scope chain so we can write `<tpl if="age &gt; 1">` instead of `<tpl if="values.age &gt; 1">`.

To keep the generated JSX clean, e2r will instead auto-prefix unqualified, uncapitalized variables with `values`. This will change the reference if you're referring to unqualified, uncapitalized variables outside of `values`, requiring manual adjustment.

## Need Help?
If your company is migrating an ExtJS app to React (or other framework) and would like some help, feel free to email me at my github username (looks like bfis----1121) at gmail.com
