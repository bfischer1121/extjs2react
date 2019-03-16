import _ from 'lodash'
import recast from 'recast'
import prettier from 'prettier'
import { namedTypes as t, builders as b, visit } from 'ast-types'
import { Ast, code, logError, getConfig } from './Util'
import SourceFile from './SourceFile'

export default class ExtJSClass{
  props = {}
  state = {}

  extractedProps = {}
  listeners      = []

  static transformedClassMembers = [
    'extend',
    'xtype',
    'alias',
    'alternateClassName',
    'override',
    'singleton',
    'requires',
    'statics',
    'mixins',
    'config',
    'cachedConfig',
    'eventedConfig'
  ]

  static transformedCmpClassMembers = [
    'controller',
    'items'
  ]

  static treatAsConfigs = [
    'listeners'
  ]

  static fromSnapshot(sourceFile, snapshot){
    let cls = new this(sourceFile, snapshot.className)

    cls.fromSnapshot = true

    cls.exportName          = snapshot.exportName
    cls.parentClassName     = snapshot.parentClassName
    cls.override            = snapshot.override
    cls.alternateClassNames = snapshot.alternateClassNames
    cls.classAliases        = snapshot.classAliases
    cls.mixins              = snapshot.mixins
    cls.plugins             = snapshot.plugins
    cls.configs             = snapshot.configs
    cls.cachedConfigs       = snapshot.cachedConfigs
    cls.eventedConfigs      = snapshot.eventedConfigs
    cls.aliasesUsed         = snapshot.aliasesUsed
    cls.methodCalls         = snapshot.methodCalls

    return cls
  }

  toSnapshot(){
    return {
      className           : this.className,
      exportName          : this.exportName,
      parentClassName     : this.parentClassName || undefined,
      override            : this.override        || undefined,
      alternateClassNames : this.alternateClassNames,
      classAliases        : this.classAliases,
      mixins              : this.mixins,
      plugins             : this.plugins,
      configs             : this.configs,
      cachedConfigs       : this.cachedConfigs,
      eventedConfigs      : this.eventedConfigs,
      aliasesUsed         : this.aliasesUsed,
      methodCalls         : this.methodCalls
    }
  }

  constructor(sourceFile, className, ast, createdFn){
    this.sourceFile = sourceFile
    this.className  = className
    this.ast       = ast
    this._createdFn = createdFn
  }

  get discard(){
    return !!this.assimilatingClass
  }

  get assimilatingClass(){
    return this._assimilatingClass
  }

  set assimilatingClass(cls){
    if(this._assimilatingClass && this._assimilatingClass !== cls){
      logError(`Assimilated ${this.className} into more than one class: ${this._assimilatingClass.className} and ${cls.className}`)
    }

    this._assimilatingClass = cls
  }

  get assimilatedClasses(){
    return _.compact([this.controller])
  }

  get parentClassName(){
    if(_.isUndefined(this._parentClassName)){
      // don't use .classMembers because of circular dependency / timing issue
      let extend = Ast.getProperty(this.ast, 'extend')
      this._parentClassName = extend ? (this._parseClassReferenceNode(extend)[0] || null) : null
    }

    return this._parentClassName
  }

  set parentClassName(name){
    this._parentClassName = name || null
  }

  get parentClass(){
    if(!this.sourceFile.codebase.allClassesRegistered){
      throw new Error('Trying to access parentClass before all classes are registered with the codebase')
    }

    if(_.isUndefined(this._parentClass)){
      this._parentClass = this.parentClassName
        ? this.sourceFile.codebase.getClassForClassName(this.parentClassName)
        : null
    }

    return this._parentClass
  }

  get ancestors(){
    let ancestors = []

    for(let parentClass = this.parentClass; parentClass; parentClass = parentClass.parentClass){
      ancestors.push(parentClass)
    }

    return ancestors
  }

  get alternateClassNames(){
    if(_.isUndefined(this._alternateClassNames)){
      // don't use .classMembers because of circular dependency / timing issue
      let names = Ast.getConfig(this.ast, 'alternateClassName')
      this._alternateClassNames = _.compact(_.isArray(names) ? names.map(name => Ast.toValue(name)) : [names])
    }

    return this._alternateClassNames
  }

  set alternateClassNames(alternateClassNames){
    this._alternateClassNames = alternateClassNames
  }

  get override(){
    if(_.isUndefined(this._override)){
      let { override } = this.classMembers
      this._override = override ? (this._parseClassReferenceNode(override)[0] || null) : null
    }

    return this._override
  }

  set override(override){
    this._override = override || null
  }

  get singleton(){
    if(_.isUndefined(this._singleton)){
      this._singleton = (
        !!this.classMembers.singleton ||
        !!this.ancestors.find(cls => cls.className === 'Ext.app.Application')
      )
    }

    return this._singleton
  }

  set singleton(singleton){
    this._singleton = !!singleton
  }

  get classAliases(){
    if(_.isUndefined(this._classAliases)){
      // don't use .classMembers because of circular dependency / timing issue
      let xtype = Ast.getProperty(this.ast, 'xtype'),
          alias = Ast.getProperty(this.ast, 'alias')

      this._classAliases = _.uniq([
        ...(xtype ? this._getAliasesFromNode('xtype', xtype) : []),
        ...(alias ? this._getAliasesFromNode('alias', alias) : [])
      ])
    }

    return this._classAliases
  }

  set classAliases(aliases){
    this._classAliases = aliases
  }

  get mixins(){
    if(_.isUndefined(this._mixins)){
      // don't use .classMembers because of circular dependency / timing issue
      let mixins = Ast.getProperty(this.ast, 'mixins')
      this._mixins = mixins ? this._parseClassReferenceNode(mixins) : []
    }

    return this._mixins
  }

  set mixins(mixins){
    this._mixins = mixins
  }

  get plugins(){
    if(_.isUndefined(this._plugins)){
      // don't use .classMembers because of circular dependency / timing issue
      let plugins = Ast.getProperty(this.ast, 'plugins')
      this._plugins = plugins ? this._parseClassReferenceNode(plugins, 'plugin') : []
    }

    return this._plugins
  }

  set plugins(plugins){
    this._plugins = plugins
  }

  get localAndInheritedConfigs(){
    if(_.isUndefined(this._localAndInheritedConfigs)){
       this._localAndInheritedConfigs = [...(this.localConfigs), ...(this.inheritedConfigs)]
     }

     return this._localAndInheritedConfigs
  }

  get localConfigs(){
    if(_.isUndefined(this._localConfigs)){
       this._localConfigs = [...(this.configs), ...(this.cachedConfigs), ...(this.eventedConfigs)]
     }

     return this._localConfigs
  }

  get inheritedConfigs(){
    if(_.isUndefined(this._inheritedConfigs)){
       this._inheritedConfigs = _.flattenDeep(_.compact([
         this.parentClass,
         ...(this.mixins.map(mixin => this.sourceFile.codebase.getClassForClassName(mixin))),
         ...(this.plugins.map(plugin => this.sourceFile.codebase.getClassForClassName(plugin)))
       ]).map(cls => cls.localAndInheritedConfigs))
     }

     return this._inheritedConfigs
  }

  get configs(){
    if(_.isUndefined(this._configs)){
      this._configs = this._getLocalConfigs('configs')
    }

    return this._configs
  }

  set configs(configs){
    this._configs = configs
  }

  get cachedConfigs(){
    if(_.isUndefined(this._cachedConfigs)){
      this._cachedConfigs = this._getLocalConfigs('cachedConfigs')
    }

    return this._cachedConfigs
  }

  set cachedConfigs(configs){
    this._cachedConfigs = configs
  }

  get eventedConfigs(){
    if(_.isUndefined(this._eventedConfigs)){
      this._eventedConfigs = this._getLocalConfigs('eventedConfigs')
    }

    return this._eventedConfigs
  }

  set eventedConfigs(configs){
    this._eventedConfigs = configs
  }

  get fileSearchRegExps(){
    return [this.className, ...(this.alternateClassNames)].map(name => new RegExp(`(${name})(\\W+?)`))
  }

  get methodCalls(){
    if(_.isUndefined(this._methodCalls)){
      let calls = []

      visit(this.ast, {
        visitCallExpression: function(path){
          let call = Ast.getMethodCall(path.node)

          if(!call.match(/[^A-Z0-9\_\$\.\[\]\(\)]/gi)){
            calls.push(call)
          }

          this.traverse(path)
        }
      })

      this._methodCalls = calls
    }

    return this._methodCalls
  }

  set methodCalls(calls){
    this._methodCalls = calls
  }

  get controller(){
    if(!this._controller){
      let configNode = this.classMembers.controller,
          alias      = configNode ? (this._getAliasesFromNode('controller', configNode) || [])[0] : null,
          className  = alias ? this.sourceFile.codebase.getClassNameForAlias(alias) : null

      this._controller = className ? this.sourceFile.codebase.getClassForClassName(className) : null

      if(this._controller){
        this._controller.assimilatingClass = this
      }
    }

    return this._controller
  }

  get aliasesUsed(){
    if(_.isUndefined(this._aliasesUsed)){
      let me          = this,
          configNames = ['xtype', 'alias', 'controller', 'viewModel'],
          aliases     = []

      visit(this.ast, {
        visitObjectExpression: function(path){
          path.node.properties.forEach(node => {
            let configName = Ast.getPropertyName(node)

            if(configNames.includes(configName)){
              aliases.push(...(me._getAliasesFromNode(configName, node.value)))
            }
          })

          this.traverse(path)
        }
      })

      this._aliasesUsed = _.uniq(_.difference(aliases, this.classAliases))
    }

    return this._aliasesUsed
  }

  set aliasesUsed(aliases){
    this._aliasesUsed = aliases
  }

  get exportName(){
    if(_.isUndefined(this._exportName)){
      this._exportName = this.sourceFile.getExportNameForClassName(this.className)
    }

    return this._exportName
  }

  set exportName(name){
    this._exportName = name
  }

  get classMembers(){
    if(_.isUndefined(this._classMembers)){
      this._classMembers = {}

      if(!this.ast){
        return this._classMembers
      }

      let kinds = {
        configs     : [],
        static      : { properties: [], methods: [] },
        properties  : [],
        methods     : [],
        transformed : []
      }

      let configNodes = (Ast.getProperty(this.ast, 'config') || {}).properties || [],
          classNodes  = [...configNodes, ...Ast.getProperties(this.ast, null, ['config'])]

      classNodes.forEach(node => {
        let name = Ast.getPropertyName(node)

        this._classMembers[name] = node.value

        if(this.localAndInheritedConfigs.includes(name) || ExtJSClass.treatAsConfigs.includes(name)){
          kinds.configs.push(node)
          return
        }

        if(name === 'statics'){
          Ast.getProperties(node.value).forEach(node => {
            kinds.static[Ast.isFunction(node.value) ? 'methods' : 'properties'].push(node)
          })
          return
        }

        if(Ast.isFunction(node.value)){
          kinds.methods.push(node)
          return
        }

        kinds[this.transformedClassMembers.includes(name) ? 'transformed' : 'properties'].push(node)
      })

      if(_.intersection(Object.keys(this._classMembers), Object.keys(kinds)).length){
        logError(`Class definition includes reserved member names (${this.className})`)
      }

      this._classMembers = { ...(this._classMembers), ...kinds }
    }

    return this._classMembers
  }

  get transformedClassMembers(){
    if(_.isUndefined(this._transformedClassMembers)){
      this._transformedClassMembers = [
        ...ExtJSClass.transformedClassMembers,
        ...(this.isComponent() ? ExtJSClass.transformedCmpClassMembers : [])
      ]
    }

    return this._transformedClassMembers
  }

  _getLocalConfigs(configType){
    let key = {
      configs        : 'config',
      cachedConfigs  : 'cachedConfig',
      eventedConfigs : 'eventedConfig'
    }[configType]

    let config  = Ast.getProperty(this.ast, key),
        configs = (Ast.getConfig(this.ast, key) || []).map(node => Ast.getPropertyName(node))

    return _.difference(configs, this.inheritedConfigs).sort((c1, c2) => c1.localeCompare(c2))
  }

  _parseClassReferenceNode(node, aliasType = null){
    let getClassName = node => {
      if(Ast.isObject(node)){
        return [
          node.properties.map(node => getClassName(node.key)),
          node.properties.map(node => getClassName(node.value))
        ]
      }

      if(Ast.isArray(node)){
        return node.elements.map(node => getClassName(node))
      }

      let value = Ast.isString(node) ? node.value : Ast.toString(node)

      if(this.sourceFile.codebase.getClassForClassName(value)){
        return value
      }

      if(aliasType){
        return this.sourceFile.codebase.getClassNameForAlias(`${aliasType}.${value}`) || null
      }

      return null
    }

    return _.compact(_.flattenDeep([getClassName(node)]))
  }

  _getAliasesFromNode(configName, node){
    let prefix = {
      xtype      : 'widget.',
      viewModel  : 'viewmodel.',
      controller : 'controller.'
    }[configName] || ''

    let handleNode = (node, aliases = []) => {
      // xtype      : String
      // alias      : String / String[]
      // controller : String / Object / Ext.app.ViewController
      // viewModel  : String / Object / Ext.app.ViewModel

      if(Ast.isString(node)){
        return [...aliases, prefix + node.value]
      }

      if(Ast.isNull(node)){
        return aliases
      }

      if(Ast.isArray(node) && ['xtype', 'alias'].includes(configName)){
        return node.elements.reduce((aliases, node) => handleNode(node, aliases), aliases)
      }

      if(Ast.isObject(node) && ['controller', 'viewModel'].includes(configName)){
        let typeNode = Ast.getProperty(node, 'type')
        return typeNode ? handleNode(typeNode, aliases) : aliases
      }

      if(Ast.isTernary(node)){
        return [node.consequent, node.alternate].reduce((aliases, node) => handleNode(node, aliases), aliases)
      }

      console.log(`Error parsing ${configName} (${this.className}): ${Ast.toString(node)}`) // logError

      return aliases
    }

    return handleNode(node)
  }

  init(){
    // touching the controller getter will flag any assimilated class for potential discard
    this.controller
  }

  pruneAST(){
    let prune = () => {
      visit(this.ast, {
        visitNode: function(path){
          if(path.node.$delete){
            path.prune()
          }

          this.traverse(path)
        }
      })

      let reprune = false

      Ast.getProperties(this.ast, ['config', 'statics']).forEach(node => {
        if(Ast.isObject(node.value) && Ast.getProperties(node.value).length === 0){
          node.$delete = true
          reprune = true
        }
      })

      if(reprune){
        prune()
      }
    }

    prune()
  }

  transpile(type = 'ES6'){
    //this.convertXTypesToJSX()

    return type === 'reactify'
      ? this.getReactifyClass()
      : this.getES6Class()
  }

  convertXTypesToJSX(){
    let me = this

    visit(this.ast, {
      visitFunctionExpression: function(path){
        visit(path.node, {
          visitObjectExpression: function(path){
            if(path.node.properties.find(node => Ast.getPropertyName(node) === 'xtype')){
              let jsx = me.getJSXFromConfig(path.node)

              if(jsx){
                path.replace(me.formatJSX(jsx))
              }
            }

            this.traverse(path)
          }
        })

        this.traverse(path)
      }
    })
  }

  getReactifiedClass(){
    return code(
      `import { reactify } from '@extjs/reactor'`,
      `const ExtJS${className} = reactify('${xtype}')`,
      '',
      `export default class ${className} extends Component{`,
      [
        'render(){',
        [
          'const {',
            props.map((prop, i) => `${prop.name}${comma(props, i)} ${getComment(prop)}`),
          '} = this.props',
          '',
          `return <ExtJS${className} {...(this.props)} />`
        ],
        '}'
      ],
      '}'
    )
  }

  getComponentFileCode({ className, xtype, props }){
    let longestProp = Math.max(0, ...props.map(prop => prop.name.length)),
        getComment  = prop => _.repeat(' ', longestProp - prop.name.length) + `// used ${prop.usage} times`,
        comma       = (array, i, space = true) => i < (array.length - 1) ? ',' : (space ? ' ' : '')

    props = props.sort((p1, p2) => p1.usage - p2.usage)

    return code(
      `import { reactify } from '@extjs/reactor'`,
      `const ExtJS${className} = reactify('${xtype}')`,
      '',
      `export default class ${className} extends Component{`,
      [
        'render(){',
        [
          'const {',
            props.map((prop, i) => `${prop.name}${comma(props, i)} ${getComment(prop)}`),
          '} = this.props',
          '',
          `return <ExtJS${className} {...(this.props)} />`
        ],
        '}'
      ],
      '}'
    )
  }

  isComponent(){
    return !![this, ...(this.ancestors)].find(cls => cls.className === 'Ext.Widget')
  }

  getES6Class(){
    let exportCode  = this.sourceFile.undiscardedClasses.length > 1 ? 'export' : 'export default',
        className   = this.exportName,
        parentName  = this.parentClass ? this.sourceFile.getImportNameForClassName(this.parentClass.className) : null,
        extendsCode = this.isComponent() ? ' extends Component' : (parentName ? ` extends ${parentName}` : ''),
        classBody   = [],
        properties  = this.getProperties(),
        methods     = this.getMethods()

    Ast.getProperties(this.ast, [
      ...(className ? ['xtype', 'alias'] : []),
      ...(parentName ? ['extend'] : []),
      'singleton'
    ]).map(node => node.$delete = true)

    if(properties.length){
      classBody.push([properties, '\n'])
    }

    if(methods.length){
      classBody.push([methods])
    }

    // controller, viewModel, cls, items, listeners, bind

    let exportClass = (!mixins.length && !this.singleton)

    return code(
      (exportClass ? (exportCode + ' ') : '') + `class ${className}${extendsCode}{`,
        ...classBody,
      '}'
      ...(exportClass ? [] : ['', exportCode + ' ' + (this.singleton ? `(new ${className}())` : className)])
    )
  }

  getProperties(){
    let properties = [...this.classMembers.static.properties, ...this.classMembers.properties].map(node => {
      this.sourceFile.codebase.logProperty(Ast.getPropertyName(node))
      node.$delete = true

      return [
        (this.singleton || this.classMembers.static.properties.includes(node)) ? 'static ' : '',
        Ast.toString(b.classProperty(node.key, node.value)).replace(/;$/, '')
      ].join('')
    })

    let defaultProps = this.classMembers.configs.filter(node => this.localConfigs.includes(Ast.getPropertyName(node)))

    if(defaultProps.length){
      properties.push(code(
        'static defaultProps = {',
          [defaultProps.map(prop => Ast.toString(prop)).join(',\n')],
        '}'
      ))
    }

    defaultProps.forEach(node => node.$delete = true)

    return properties.join('\n\n')
  }

  getMethods(){
    let getMethodName = name => ({
      'constructor': this.isComponent() ? 'REWRITE_constructor' : 'constructor'
    }[name] || name)

    let transformMethod = node => {
      let name   = b.identifier(getMethodName(Ast.getPropertyName(node))),
          method = b.classMethod('method', name, node.value.params, node.value.body)

      node.$delete = true

      return [
        this.classMembers.static.methods.includes(node) ? 'static ' : '',
        node.value.async ? 'async ' : '',
        Ast.toString(method).replace(/\) \{/, '){')
      ].join('')
    }

    let cmpConstructor = null,
        methods        = []

    if(this.isComponent()){
      methods.push(this.getRenderFn())
    }

    [...this.classMembers.static.methods, ...this.classMembers.methods].forEach(node => {
      if(Ast.getPropertyName(node) === 'constructor'){
        cmpConstructor = transformMethod(node)
        return
      }

      methods.push(transformMethod(node))
    })

    let constructor = this.getConstructorFn()

    if(constructor){
      methods.unshift(constructor)
    }

    if(cmpConstructor){
      methods.unshift(cmpConstructor)
    }

    if(this.controller){
      methods.push(...(this.controller.classMembers.methods.map(transformMethod)))
    }

    return methods.join('\n\n')
  }

  getConstructorFn(){
    let body = []

    if(this.isComponent() && !this._listenersParsed){
      throw new Error('Need to parse listeners before creating constructor')
    }

    if(this.listeners.length){
      let listeners = _.uniq(this.listeners).sort((l1, l2) => l1.localeCompare(l2)),
          longestFn = Math.max(0, ...listeners.map(fn => fn.length))

      body.push(...listeners.map(fn => `this.${fn.padEnd(longestFn)} = this.${fn}.bind(this)`))
    }

    if(!body.length){
      return null
    }

    return code(
      'constructor(props){',
        [
          'super(props)\n',
          ...body
        ],
      '}'
    )
  }

  getRenderFn(){
    let identifier = b.jsxIdentifier(this.sourceFile.getImportNameForClassName(this.parentClass.className)),
        items      = _.compact((Ast.toValue(this.classMembers.items) || []).map(item => this.getJSXFromConfig(item)))

    let props = this.classMembers.configs.filter(node => !this.localConfigs.includes(Ast.getPropertyName(node)))

    props.forEach(prop => prop.$delete = true)

    props = [
      ...this.getPropsFromConfig(b.objectExpression(props), true),
      b.jsxSpreadAttribute(b.memberExpression(b.thisExpression(), b.identifier('props')))
    ]

    let jsx = b.jsxElement(
      b.jsxOpeningElement(identifier, props),
      b.jsxClosingElement(identifier),
      items,
      items.length === 0
    )

    let renderBody = [
      'return (',
      [this.getCodeFromJSX(jsx)],
      ')',
    ]

    let extractedProps = Object.keys(this.extractedProps).map(name => (
      `const ${name} = ${Ast.toString(this.extractedProps[name])}`
    )).join('\n\n')

    if(extractedProps.length){
      renderBody.unshift(extractedProps + '\n')
    }

    this._listenersParsed = true

    return code('render(){', renderBody, '}')
  }

  formatJSX(ast){
    let code = `let foo = ${Ast.toString(ast)}`

    try{
      let formatted = prettier.format(code, { parser: 'babel', printWidth: 200 }).replace(/;\s*$/, '')
      return Ast.parseWithJSX(formatted).declarations[0].init
    }
    catch(e){
      console.log(`Error formatting JSX (${this.className})`, e)
      return ast
    }
  }

  getCodeFromJSX(jsx){
    jsx = Ast.toString(jsx)

    try{
      return prettier.format(jsx, { parser: 'babel', printWidth: 200 }).replace(/;\s*$/, '')
    }
    catch(e){
      console.log(`Error formatting JSX (${this.className})`, e)
      return jsx
    }
  }

  getJSXFromConfig(config){
    if(!t.ObjectExpression.check(config)){
      return null
    }

    let xtype      = Ast.getConfig(config, 'xtype'),
        importName = xtype ? this.sourceFile.getImportNameForAlias(`widget.${xtype}`) : null,
        identifier = importName ? b.jsxIdentifier(importName) : null,
        props      = this.getPropsFromConfig(config),
        children   = _.compact((Ast.getConfig(config, 'items') || []).map(item => this.getJSXFromConfig(item)))

    if(!identifier){
      return null
    }

    config.$delete = true

    if(!children.length){
      return b.jsxElement(b.jsxOpeningElement(identifier, props, true))
    }

    return b.jsxElement(
      b.jsxOpeningElement(identifier, props),
      b.jsxClosingElement(identifier),
      children.reduce((children, child) => ([...children, child, b.jsxText('\n')]), []),
      children.length === 0
    )
  }

  getPropsFromConfig(node, rootEl = false){
    let skippedConfigs = ['xtype', 'items', ...(rootEl ? this.transformedClassMembers : [])],
        getPropName    = configName => ({ 'cls': 'className' }[configName] || configName)

    let props = Ast.getPropertiesExcept(node, ...skippedConfigs).map(node => {
      let configName = Ast.getPropertyName(node)

      if(configName === 'handler'){
        return this.getPropFromListener(node)
      }

      if(configName === 'listeners'){
        return node.value.properties.map(node => this.getPropFromListener(node))
      }

      let name  = getPropName(configName),
          value = node.value,
          prop  = value => b.jsxAttribute(b.jsxIdentifier(name), value)

      if(this._shouldExtractJSXValue(value)){
        value = b.identifier(this._extractProp(name, value))
      }

      if(Ast.isBoolean(value) && !!value.value){
        return prop(null)
      }

      if(Ast.isString(value)){
        return prop(value)
      }

      return prop(b.jsxExpressionContainer(value))
    })

    return _.compact(_.flattenDeep(props))
  }

  getPropFromListener(node){
    let eventName = Ast.getPropertyName(node)

    if(['element', 'scope'].includes(eventName)){
      return null
    }

    let name  = 'on' + (eventName === 'handler' ? 'Tap' : this.sourceFile.codebase.capitalize(eventName)),
        value = node.value

    if(Ast.isString(value)){
      this.listeners.push(value.value)
      value = b.memberExpression(b.thisExpression(), b.identifier(value.value))
    }

    return b.jsxAttribute(b.jsxIdentifier(name), b.jsxExpressionContainer(value))
  }

  _shouldExtractJSXValue(node){
    let checkRe = /<[^>]+>|,|\.|\?/ig,
        extract = false

    visit(node, {
      visitLiteral: function(path){
        if(Ast.isString(path.node) && checkRe.test(path.node.value)){
          extract = true
        }

        this.traverse(path)
      }
    })

    return extract
  }

  _extractProp(name, value, instance = 1){
    let keyedName = `${name}${instance === 1 ? '' : instance}`

    if(this.extractedProps[keyedName]){
      return this._extractProp(name, value, instance + 1)
    }

    this.extractedProps[keyedName] = value
    return keyedName
  }
}