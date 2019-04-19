import _ from 'lodash'
import recast from 'recast'
import prettier from 'prettier'
import parse5 from 'parse5'
import Serializer from 'parse5/lib/serializer'
import { namedTypes as t, builders as b, visit } from 'ast-types'
import { Ast, code, logError, getConfig } from './Util'
import SourceFile from './SourceFile'

export default class ExtJSClass{
  props     = {}
  state     = {}
  accessors = []

  evented = false

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
    this.ast        = ast
    this._createdFn = createdFn
  }

  get libraries(){
    return (this.isComponent() ? ['react'] : []).concat(this._libraries || [])
  }

  get unparsed(){
    return !!this.override
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

  get localAndInheritedAccessors(){
    return [...(this.accessors), ...(this.inheritedAccessors)]
  }

  get inheritedAccessors(){
    if(_.isUndefined(this._inheritedAccessors)){
       this._inheritedAccessors = _.flattenDeep(_.compact([
         this.parentClass,
         ...(this.mixins.map(mixin => this.sourceFile.codebase.getClassForClassName(mixin))),
         ...(this.plugins.map(plugin => this.sourceFile.codebase.getClassForClassName(plugin)))
       ]).map(cls => cls.localAndInheritedAccessors))
     }

     return this._inheritedAccessors
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
    return [this.className, ...(this.alternateClassNames)].map(name => (
      new RegExp(`('?${name}'?)(\\W+?)`)
    ))
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

  _addLibrary(library){
    this._libraries = _.uniq([...(this._libraries || []), library])
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

  _deleteNode(node){
    node.$delete = true
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
          this._deleteNode(node)
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

    if(this.unparsed){
      return { classCode: `Ext.define('${this.className}', ${Ast.toString(this.ast)})`, unparsed: true }
    }

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
    let className     = this.exportName,
        parentName    = this.parentClass ? this.sourceFile.getImportNameForClassName(this.parentClass.className) : null,
        classBody     = [],
        staticProps   = this.getStaticProperties(),
        properties    = this.getProperties(),
        configs       = this.getConfigs(),
        staticMethods = this.getStaticMethods(),
        methods       = this.getMethods()

    Ast.getProperties(this.ast, [
      ...(className ? ['xtype', 'alias'] : []),
      ...(parentName ? ['extend'] : []),
      'singleton', 'mixins'
    ]).map(this._deleteNode)

    let mixins = this.mixins.map(mixinClassName => (
      `Object.assign(${className}.prototype, ${this.sourceFile.getImportNameForClassName(mixinClassName)}.prototype)`
    ))

    // controller, viewModel, cls, items, listeners, bind

    let exportClass     = (!mixins.length && !this.singleton && !this.isComponent()),
        exportStatement = this.sourceFile.undiscardedClasses.length > 1 ? 'export' : 'export default'

    let exportCode = code(
      ...(mixins.length ? [...mixins, ''] : []),
      ...(exportClass ? [] : [this.singleton ? `${exportStatement} (new ${className}())` : `${exportStatement} ${className}`])
    )

    const getCode = (...members) => _.compact(members.map(members => members.join('\n\n'))).join('\n\n')

    if(this.isComponent()){
      this._addLibrary('React')

      let body     = getCode(properties, configs, methods),
          renderFn = this.getRenderFn()

      let classCode = code(
        `function ${className}(props){`,
          ...(body.length ? [[body]] : []),
          ...((body.length && renderFn.length) ? [''] : []),
          ...(renderFn.length ? [renderFn] : []),
        '}',
        ...((staticMethods.length || staticProps.length) ? ['', getCode(staticMethods, staticProps)] : [])
      )

      return { classCode, exportCode }
    }

    if(parentName){
      this._addLibrary('define')
    }

    let head = [
      parentName ? '@define\n' : '',
      (exportClass ? exportStatement + ' ' : ''),
      `class ${className}`
    ].join('')

    let body = getCode(staticProps, properties, configs, staticMethods, methods)

    let classCode = code(
      head + '{',
        ...(parentName ? [[`extend = ${parentName}\n`]] : []),
        ...(body.length ? [[body]] : []),
      '}'
    )

    return { classCode, exportCode }
  }

  getProperties(){
    return [
      ...this.classMembers.properties,
      ...this.assimilatedClasses.reduce((properties, cls) => [...properties, ...cls.classMembers.properties], [])
    ].map(node => this._getCodeForProperty(node))
  }

  getStaticProperties(){
    return [
      ...this.classMembers.static.properties,
      ...this.assimilatedClasses.reduce((properties, cls) => [...properties, ...cls.classMembers.static.properties], [])
    ].map(node => this._getCodeForProperty(node, true))
  }

  getConfigs(){
    let configs = [
      ...this.classMembers.configs,
      ...this.assimilatedClasses.reduce((configs, cls) => [...configs, ...cls.classMembers.configs], [])
    ]

    let deleteNodes = configs => configs.forEach(this._deleteNode),
        configCode  = []

    if(!configs.length){
      return []
    }

    if(this.isComponent()){
      let props = this._getProps(true)

      if(props.length){
        configCode.push(code(
          'props = {',
            [[...props.map(node => Ast.toString(node)), '...props'].join(',\n')],
          '}'
        ))
      }

      deleteNodes(props)
      configs = _.difference(configs, props)
      return configCode
    }

    if(configs.length){
      let accessors   = configs.map(node => this.getAccessorsFromConfig(node)),
          longestProp = Math.max(0, ...accessors.map(({ internalName }) => internalName.length))

      this.accessors = _.compact(accessors.map(({ externalName }) => externalName))

      let props = accessors
        .sort((p1, p2) => (p1.internalName.startsWith('_') ? 1 : 0) - (p2.internalName.startsWith('_') ? 1 : 0))
        .map(({ internalName, defaultValue }) => `${internalName.padEnd(longestProp)} = ${defaultValue}`)

      configCode.push([
        ...(props.length ? [props.join('\n')] : []),
        ..._.compact(accessors.map(({ methods }) => methods))
      ].join('\n\n'))
    }

    deleteNodes(configs)

    return configCode
  }

  getAccessorsFromConfig(node, evented = false){
    let name         = Ast.toString(node.key),
        defaultValue = Ast.toString(node.value).replace(/;$/, ''),
        capitalized  = name[0].toUpperCase() + name.slice(1),
        applyFn      = this.classMembers[`apply${capitalized}`],
        updateFn     = this.classMembers[`update${capitalized}`],
        eventName    = `${name.toLowerCase()}change`,
        beforeGet    = [],
        beforeSet    = []

    if(!applyFn && !updateFn && !evented){
      return { externalName: name, internalName: name, defaultValue }
    }

    if(applyFn || updateFn){
      beforeGet.push(code(
        `if(!this._${name}Initialized){`,
          [`this.${name} = this._${name}`],
        '}'
      ))
    }

    if(applyFn){
      beforeSet.push(`value = (${Ast.toString(applyFn)}).call(this, value, this._${name}Initialized ? this._${name} : undefined)`)
      this._deleteNode(this.classMembers.methods.find(node => node.value === applyFn))
    }

    if(updateFn){
      let update = `(${Ast.toString(updateFn)}).call(this, value, this._${name})`
      beforeSet.push(applyFn ? code(`if(typeof value !== 'undefined' && value !== this._${name}){`, [update], `}`) : update)
      this._deleteNode(this.classMembers.methods.find(node => node.value === updateFn))
    }

    if(evented){
      this.evented = true
      beforeSet.push(
        `if(this._${name}Initialized){`,
          [`this.dispatchEvent(${eventName}, this, value, this._${name})`],
        '}'
      )
    }

    if(applyFn || updateFn){
      beforeSet.push(`this._${name}Initialized = true`)
    }

    let methods = code(
      `get ${name}(){`,
        [
          ...(beforeGet.length ? [beforeGet.join('\n\n') + '\n'] : []),
          `return this._${name}`
        ],
      '}',
      '',
      `set ${name}(value){`,
        [
          ...(beforeSet.length ? [beforeSet.join('\n\n') + '\n'] : []),
          `this._${name} = value`
        ],
      '}'
    )

    return { externalName: name, internalName: `_${name}`, defaultValue, methods }
  }

  getMethods(){
    let methods = [
      ...this.classMembers.methods.filter(method => !method.$delete).map(node => this._getCodeForMethod(node, this, false)),
      ...this.assimilatedClasses.reduce((methods, cls) => [
        ...methods,
        ...cls.classMembers.methods.map(node => this._getCodeForMethod(node, cls, false))
      ], [])
    ]

    let applyMethods = methods
      .filter(m => _.isObject(m) && m.isApplyFn)
      .sort((m1, m2) => m1.config.localeCompare(m2.config))
      .map(m => `props.${m.config} = useMemo(${m.fn}, [props.${m.config}])`)

    let updateMethods = methods
      .filter(m => _.isObject(m) && m.isUpdateFn)
      .sort((m1, m2) => m1.config.localeCompare(m2.config))
      .map(m => `useEffect(${m.fn}, [props.${m.config}])`)

    if(applyMethods.length){
      this._addLibrary('useMemo')
    }

    if(updateMethods.length){
      this._addLibrary('useEffect')
    }

    return [
      ...applyMethods,
      ...updateMethods,
      ...methods.filter(m => !_.isObject(m))
    ]
  }

  getStaticMethods(){
    return [
      ...this.classMembers.static.methods.filter(method => !method.$delete).map(node => this._getCodeForMethod(node, this, true)),
      ...this.assimilatedClasses.reduce((methods, cls) => [
        ...methods,
        ...cls.classMembers.static.methods.map(node => this._getCodeForMethod(node, cls, true))
      ], [])
    ]
  }

  _getCodeForProperty(node, isStatic){
    this.sourceFile.codebase.logProperty(Ast.getPropertyName(node))
    this._deleteNode(node)

    if(this.isComponent()){
      let property = isStatic
        ? `${this.exportName}.${Ast.toString(node.key)} = ${Ast.toString(node.value)}`
        : `let ${Ast.toString(node.key)} = ${Ast.toString(node.value)}`

      if(!Ast.isIdentifier(node.key) && !Ast.isMemberExpression(node.key)){
        return `/* ${property.replace('\*\/', '*//*')} */`
      }

      return property
    }

    return (isStatic ? 'static ' : '') + Ast.toString(b.classProperty(node.key, node.value))
  }

  _getCodeForMethod(node, cls, isStatic){
    this._deleteNode(node)

    let getMethodName = name => ({
      'constructor': this.isComponent() ? 'REWRITE_constructor' : 'construct'
    }[name] || name)

    let name = getMethodName(Ast.getPropertyName(node))

    const getConfigName = () => {
      if(isStatic || !cls.classMembers.methods.includes(node)){
        return null
      }

      let config = name.replace(/^(apply|update)/, '')
      config = config[0].toLowerCase() + config.slice(1)

      return cls.classMembers.configs.find(node => Ast.getPropertyName(node) === config) ? config : null
    }

    if(this.isComponent()){
      this._replaceMethodReferences(node, name, cls, isStatic)

      let config = getConfigName(),
          fn     = Ast.toString(b.arrowFunctionExpression(node.value.params, node.value.body))

      if(config && name.startsWith('apply')){
        return { isApplyFn: true, config, fn }
      }

      if(config && name.startsWith('update')){
        return { isUpdateFn: true, config, fn }
      }

      if(name === 'initialize' && !isStatic){
        return `useEffect(${node.value.async ? 'async ' : ''}${fn}, [])`
      }

      return [
        isStatic ? `${this.exportName}.${name} = ` : `const ${name} = `,
        node.value.async ? 'async ' : '',
        fn
      ].join('')
    }

    return [
      isStatic ? 'static ' : '',
      node.value.async ? 'async ' : '',
      Ast.toString(b.classMethod('method', b.identifier(name), node.value.params, node.value.body)).replace(/\) \{/, '){')
    ].join('')
  }

  _replaceMethodReferences(node, name, cls, isStatic){
    const isLocalMember = node => !!cls.classMembers[_.isString(node) ? node : Ast.toString(node)]

    const processReference = path => {
      const { node } = path

      // only replace this.foo and me.foo references
      if(node.object.type !== 'ThisExpression' && !(Ast.isIdentifier(node.object) && node.object.name === 'me')){
        return
      }

      const { property } = node

      // this.foo() -> foo()
      if(isLocalMember(property)){
        path.replace(property)
        return
      }

      // this[disabled ? 'enable' : 'disable']() -> (disabled ? enable : disable)()
      if(Ast.isTernary(property)){
        let { test, consequent, alternate } = property

        consequent = Ast.isString(consequent) ? consequent.value : Ast.toString(consequent)
        alternate  = Ast.isString(alternate) ? alternate.value : Ast.toString(alternate)

        if(isLocalMember(consequent) && isLocalMember(alternate)){
          path.replace(Ast.from(`(${Ast.toString(test)} ? ${consequent} : ${alternate})`))
        }

        return
      }
    }

    const callReplacements = {
      'this.getView': 'this'
    }

    const memberReplacements = {
      'this.view' : 'this'
    }

    if(name === 'initialize' && !isStatic){
      callReplacements['this.callParent'] = false
    }

    const replace = (path, replacement) => {
      if(replacement === false){
        path.prune()
      }

      if(replacement){
        path.replace(Ast.from(replacement))
      }
    }

    visit(node, {
      visitCallExpression: function(path){
        replace(path, callReplacements[Ast.toString(path.node.callee)])
        this.traverse(path)
      },

      visitMemberExpression: function(path){
        replace(path, memberReplacements[Ast.toString(path.node)])
        this.traverse(path)
      }
    })

    visit(node, {
      visitMemberExpression: function(path){
        processReference(path)
        this.traverse(path)
      }
    })
  }

  _getProps(processed){
    let shouldProcess = node => this.localConfigs.includes(Ast.getPropertyName(node))
    return this.classMembers.configs.filter(node => shouldProcess(node) === !!processed)
  }

  getRenderFn(){
    let identifier = b.jsxIdentifier(this.sourceFile.getImportNameForClassName(this.parentClass.className)),
        props      = this._getProps(false),
        items      = _.compact((Ast.toValue(this.classMembers.items) || []).map(item => this.getJSXFromConfig(item)))

    props.forEach(this._deleteNode)

    props = [
      ...this.getPropsFromConfig(b.objectExpression(props), true),
      b.jsxSpreadAttribute(b.identifier('props'))
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
      `const ${name} = ${this._transformProp(name, this.extractedProps[name])}`
    )).join('\n\n')

    if(extractedProps.length){
      renderBody.unshift(extractedProps + '\n')
    }

    this._listenersParsed = true

    return code(renderBody)
  }

  formatJSX(astOrString){
    let string = _.isString(astOrString) ? astOrString : Ast.toString(astOrString).replace(/(^\{|\}$)/g, ''),
        code   = `let foo = ${string}`

    try{
      let options   = { parser: 'babel', printWidth: 200 },
          formatted = Ast.parseWithJSX(prettier.format(code, options).replace(/;\s*$/, '')).declarations[0].init

      return _.isString(astOrString) ? Ast.toString(formatted) : formatted
    }
    catch(e){
      console.log(`Error formatting JSX (${this.className})`, e)
      return astOrString
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

  getJSXFromConfig(config, xtype = null){
    if(!t.ObjectExpression.check(config)){
      return null
    }

    xtype = xtype || Ast.getProperty(config, 'xtype')

    if(Ast.isTernary(xtype)){
      let [consequent, alternate] = [xtype.consequent, xtype.alternate].reduce((jsx, xtype) => (
        [...jsx, this.getJSXFromConfig(config, xtype)]
      ), [])

      return b.jsxExpressionContainer(b.conditionalExpression(xtype.test, consequent, alternate))
    }

    xtype = Ast.toValue(xtype)

    let importName = xtype ? this.sourceFile.getImportNameForAlias(`widget.${xtype}`) : null,
        identifier = importName ? b.jsxIdentifier(importName) : null,
        props      = this.getPropsFromConfig(config),
        children   = _.compact((Ast.getConfig(config, 'items') || []).map(item => this.getJSXFromConfig(item)))

    if(!identifier){
      return null
    }

    this._deleteNode(config)

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
      value = b.identifier(value.value)
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

  _transformProp(name, value){
    let propCode = Ast.toString(value)

    if(['tpl', 'itemTpl'].includes(name)){
      this._addLibrary('Template')
      propCode = this._getTpl(value)
    }

    return propCode
  }

  _getTpl(value){
    if(!Ast.isArray(value) && !Ast.isString(value)){
      return Ast.toString(value)
    }

    // { tpl: ['<div>{value:this.doSomething}</div>', { ...this is the helper... }] }
    let lastItem = Ast.isArray(value) ? value.elements[value.elements.length - 1] : null,
        helper   = null

    if(lastItem && (Ast.isIdentifier(lastItem) || Ast.isMemberExpression(lastItem) || Ast.isObject(lastItem))){
      helper = Ast.isObject(lastItem) ? 'helper' : Ast.toString(lastItem)
    }

    let tpl = Ast.isArray(value)
      ? value.elements.filter(el => Ast.isString(el)).map(el => el.value).join('')
      : value.value

    tpl = this._convertTplInterpolations(tpl, helper)

    // close some tpl tags so it's valid xml for parsing
    tpl = tpl.replace(/\<tpl else/g, '</tpl><tpl else')

    tpl = parse5.parseFragment(tpl)

    const visitHtml = (node, fn) => {
      let traverse = (node => (
        () => (node.childNodes || []).map(childNode => visitHtml(childNode, fn))
      ))(node)

      return node.nodeName === '#document-fragment' ? traverse().join('') : fn(node, traverse)
    }

    let wrap = (tpl.childNodes.length > 1)

    let inlineCodeRe = /\{([^\}]+)\}/g,
        onlyNodesRe  = /^\<(.+)\>$/,
        onlyCodeRe   = /^\{([^\}]+)\}$/

    let encodings = [
      [/&gt;/g,  '>'],
      [/&gte;/g, '>='],
      [/&lt;/g,  '<'],
      [/&lte;/g, '<='],
      [/&amp;/g, '&']
    ]

    let unencode = string => (
      encodings.reduce((string, [encoded, unencoded]) => string.replace(encoded, unencoded), string)
    )

    let getAttr = (node, name) => ((node.attrs || []).find(a => a.name === name) || {}).value

    tpl = visitHtml(tpl, (node, traverse) => {
      // text, comment, etc
      if(!node.tagName){
        return parse5.serialize({ childNodes: [node] })
      }

      let childNodes = traverse()

      if(node.tagName === 'tpl'){
        let code      = childNodes.join(''),
            onlyNodes = onlyNodesRe.test(code),
            onlyCode  = onlyCodeRe.test(code)

        // e.g., <i>John</i> <b>Doe</b> -> <><i>John</i> <b>Doe</b></>
        if(onlyNodes){
          code = childNodes.length > 1 ? `<>${code}</>` : code
        }

        // e.g., {data.disabled ? 'disabled' : 'enabled'} -> (data.disabled ? 'disabled' : 'enabled')
        if(onlyCode){
          code = code.replace(onlyCodeRe, '$1')
          code = code.includes(' ') ? `(${code})` : code
        }

        // e.g., {data.username} was here -> <>{data.username} was here</>
        if(!onlyNodes && !onlyCode){
          code = `<>${code}</>`
        }

        let test = this._scopeTplVariables((getAttr(node, 'if') || 'false').replace(/values/g, 'data'), 'data')

        // e.g., data.is_admin && data.state === 'Active' -> (data.is_admin && data.state === 'Active')
        if(test.includes('&&') || test.includes('||') || test.includes('?')){
          test = `(${test})`
        }

        return `{${test} && ${code}}`
      }

      let attrs = (node.attrs || []).map(attr => {
        let name  = { 'class' : 'className' }[attr.name] || attr.name,
            value = Serializer.escapeString(attr.value, true)

        // XTemplate interpolations -> ES6
        // <div className="button {disabledCls}"> -> <div className={`button ${disabledCls}`}>
        let assignment = inlineCodeRe.test(value)
          ? '{`' + value.replace(inlineCodeRe, (match, code) => '${' + code + '}') + '`}'
          : `"${value}"`

        return `${name}=${assignment}`
      }).join(' ')

      let selfClosing = ['area', 'br', 'embed', 'frame', 'hr', 'img', 'input'].includes(node.tagName)

      return [
        `<${node.tagName}${attrs.length ? ' ' + attrs : ''}`,
        (childNodes.length || !selfClosing) ? `>${childNodes.join('')}</${node.tagName}>` : ' />'
      ].join('')
    })

    tpl = tpl.replace(/&quot;/g, '"').replace(/&apos;/g, '\'')

    tpl = unencode(tpl)

    tpl = (wrap || !onlyNodesRe.test(tpl)) ? `<>${tpl}</>` : tpl.replace(onlyCodeRe, '$1')

    tpl = onlyNodesRe.test(tpl) ? this.formatJSX(tpl) : tpl

    if(helper === 'helper'){
      return code(
        'new Template(data => {',
          [
            `const helper = ${Ast.toString(lastItem)}`,
            '',
            ...(tpl.includes('\n') ? ['return (', [tpl], ')'] : [`return ${tpl}`])
          ],
        '})'
      )
    }

    return code('new Template(data => (', [tpl], '))')
  }

  _convertTplInterpolations(tpl, helper){
    let inlineCodeRe  = /\{\[(.+?)(?=\]\})/g,
        fieldRe       = /\{([^\}]+)\}/g,
        offsetOffset  = 0,
        inlineOffsets = [],
        replaceQuotes = code => code.replace(/\"/g, '&quot;').replace(/\'/g, '&apos;')

    // {[ ... ]} -> { ... }
    tpl = tpl.replace(inlineCodeRe, (match, original, offset) => {
      let code = '{' + replaceQuotes(original.trim()) + '}'

      // TODO: support for out, values, parent, xindex, xcount, xkey
      code = code.replace(/values/g, 'data')

      code = code.replace(/this\./g, helper ? helper + '.' : '')

      offset = offset + offsetOffset
      inlineOffsets.push([offset, offset + code.length])

      offsetOffset += (code.length - original.length) - 2

      return code
    })

    // {field:fnName(extraArgs)} -> {(helper|Ext.util.Format).fnName(field, ...extraArgs)}
    tpl = tpl.replace(fieldRe, (match, code, offset) => {
      // don't modify objects within {[ ... ]}
      if(inlineOffsets.find(([start, end]) => offset >= start && offset <= end)){
        return match
      }

      code = replaceQuotes(code.trim())

      let [field, fnCall] = code.split(':')

      field = field === '.' ? 'data' : `data.${field}`

      if(!fnCall){
        return `{${field}}`
      }

      let [, fnName, , extraArgs] = fnCall.match(/([^\(]+)(\((.+)\))?/),
          fn   = fnName.startsWith('this.') ? `${helper}.${fnName.replace(/^this\./, '')}` : `Ext.util.Format.${fnName}`,
          args = _.compact([field, extraArgs]).join(', ')

      return `{${fn}(${args})}`
    })

    // remove leftover ]}'s since they're lookahead values in inlineCodeRe
    tpl = tpl.replace(/\}\]\}/g, '}')

    return tpl
  }

  _scopeTplVariables(code, scope){
    const ast         = Ast.from(code),
          shouldScope = name => (!['this', scope].includes(name) && name[0] === name[0].toLowerCase())

    // "foo" -> "scope.foo"
    visit(ast, {
      visitIdentifier: function(path){
        if(!Ast.isMemberExpression(path.parent.node) && shouldScope(path.node.name)){
          path.replace(Ast.from(`${scope}.${path.node.name}`).expression)
        }

        this.traverse(path)
      }
    })

    // "foo.bar" -> "scope.foo.bar"
    visit(ast, {
      visitMemberExpression: function(path){
        if(
          !Ast.isMemberExpression(path.parent.node) &&
          Ast.isIdentifier(path.node.object) &&
          shouldScope(path.node.object.name)
        ){
          path.replace(Ast.from(`${scope}.${Ast.toString(path.node)}`).expression)
        }

        this.traverse(path)
      }
    })

    return Ast.toString(ast)
  }
}