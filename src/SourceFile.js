import _ from 'lodash'
import recast from 'recast'
import { builders as b, visit } from 'ast-types'
import Ast from './Ast'
import { code, getRelativePath, logError } from './Util'
import ExtJSClass from './ExtJSClass'
import * as hooks from './Hooks'

export default class SourceFile{
  classes = []

  _importNames = {}
  _exportNames = {}

  unknown = { aliases: [], classNames: [] }

  static async factory(config){
    let sourceFile = new this(config)

    if(sourceFile.parseable){
      await sourceFile.processAST()
    }

    return sourceFile
  }

  static fromSnapshot(codebase, { codeFilePath, parseable, classes }){
    let sourceFile = new this({ codebase, codeFilePath })

    sourceFile.fromSnapshot = true

    sourceFile.parseable = parseable
    sourceFile.classes   = classes.map(snapshot => ExtJSClass.fromSnapshot(sourceFile, snapshot))

    return sourceFile
  }

  toSnapshot(){
    return {
      codeFilePath : this.codeFilePath,
      parseable    : this.parseable,
      classes      : this.classes.map(cls => cls.toSnapshot())
    }
  }

  constructor({ codebase, codeFilePath, source, ast }){
    this.codebase     = codebase
    this.codeFilePath = codeFilePath

    this._source  = source
    this._ast     = ast

    // touch this property to determine it before any transformations
    this._astIsPerfect
  }

  get importFilePath(){
    return this.codebase.manifestFilePath || this.codeFilePath
  }

  get undiscardedClasses(){
    return this.classes.filter(cls => !cls.discard)
  }

  get classesUsed(){
    if(!this._classesUsed){
      let aliases    = this._aliasesUsed,
          classNames = this._classNamesUsed,
          classes    = []

      aliases.forEach(alias => {
        let className = this.codebase.getClassNameForAlias(alias)
        className ? classNames.push(className) : this.unknown.aliases.push(alias)
      })

      classNames.forEach(className => {
        let cls = this.codebase.getClassForClassName(className)
        cls ? classes.push(cls) : this.unknown.classNames.push(className)
      })

      this._classesUsed = _.uniq(classes)
    }

    return this._classesUsed
  }

  get _ast(){
    if(!this.__ast && this.parseable){
      try{
        this.__ast = recast.parse(this._source)
      }
      catch(e){
        throw `Error parsing source file (${filePath}): ${e}`
      }
    }

    return this.__ast
  }

  set _ast(ast){
    this.__ast = ast
  }

  get parseable(){
    if(_.isUndefined(this._parseable)){
      this._parseable = (/Ext\.define\(\s*['|"][^'|"]+['|"]/g).test(this._source)
    }

    return this._parseable
  }

  set parseable(parseable){
    this._parseable = parseable
  }

  get discard(){
    return !this.undiscardedClasses.length
  }

  get _astIsPerfect(){
    if(_.isUndefined(this.__astIsPerfect)){
      this.__astIsPerfect = (Ast.toString(this._ast) === this._source)
    }

    return this.__astIsPerfect
  }

  get _aliasesUsed(){
    return _.uniq(this.undiscardedClasses.reduce((aliases, cls) => ([...aliases, ...cls.aliasesUsed]), []))
  }

  get _classNamesUsed(){
    let internalCls = this.classes.map(cls => cls.className)

    let externalCls = this.codebase.classRe.reduce((classes, { re, cls }) => (
      [...classes, ...(re.test(this._source) ? [cls.className] : [])
    ]), [])

    return _.uniq(_.difference(externalCls, internalCls))
  }

  async processAST(){
    let processClassDefinition = node => {
      let [className, data, createdFn] = node.arguments

      if(Ast.isNull(className)){
        return
      }

      if(!Ast.isString(className)){
        console.log(`Error parsing Ext.define call (${this.codeFilePath}): Expected first argument to be a string`)
        return
      }

      if(Ast.isFunction(data)){
        let returnStatements = data.body.body.filter(node => node.type === 'ReturnStatement')

        if(returnStatements.length === 1){
          data = returnStatements[0].argument
        }
      }

      if(!Ast.isObject(data)){
        console.log(`Error parsing Ext.define call (${className.value}): Expected second argument to be a function or object`)
        return
      }

      this.classes.push(new ExtJSClass(this, className.value, data, createdFn))
    }

    visit(this._ast, {
      visitCallExpression: function(path){
        let { node } = path

        if(Ast.getMethodCall(node) === 'Ext.define'){
          processClassDefinition(node)
        }

        this.traverse(path)
      },

      visitNode: function(path){
        (path.node.comments || []).forEach(comment => {
          let lines = _.compact(comment.value.split('\n').map(line => line.trim().replace(/^\*\s*/, ''))),
              label = (lines.shift() || '').toLowerCase()

          if(label === 'classes:'){
            lines.slice(1).forEach(className => {
              let classNode = Ast.from(`Ext.define('${className}', {})`).expression
              processClassDefinition(classNode)
            })
          }
        })

        this.traverse(path)
      }
    })
  }

  getUnparsedCode(){
    if(this._astIsPerfect){
      this.classes.forEach(cls => cls.pruneAST())
      this.removeEmptyClasses()
    }

    if(this.classes.every(cls => cls.unparsed)){
      return ''
    }

    let code   = Ast.toString(this._ast).trim(),
        define = /Ext\.define\(/

    return code.match(define) ? code.replace(define, 'try{(') + '} catch(e){}' : code
  }

  transpile(){
    if(this.fromSnapshot){
      throw 'Cannot transpile from snapshot'
    }

    let clsCode   = this.undiscardedClasses.map(cls => cls.transpile()),
        libraries = _.uniq(this.undiscardedClasses.reduce((lib, cls) => [...lib, ...cls.libraries], []))

    let classes = _.compact(clsCode.map(({ classCode, unparsed }) => {
      if(!classCode || unparsed){
        return classCode
      }

      classCode = this.replaceClassNames(classCode)

      let ast = Ast.parseWithJSX(classCode)

      this.renameConfigCalls(ast)

      if(hooks.afterTranspile){
        libraries.push(...hooks.afterTranspile(ast))
      }

      return Ast.toString(ast)
    }))

    let imports = this.getImportsCode(_.uniq(libraries))

    let code = _.compact([
      imports,
      ...classes,
      ...(_.compact(clsCode.map(code => code.exportCode)))
    ]).join('\n\n').trim()

    if(hooks.beforeSave){
      code = hooks.beforeSave(code)
    }

    return _.compact([this.getUnparsedCode(), code]).join('\n\n')
  }

  getImportsCode(libraries){
    let libImports = [
      { source: 'framework', specifiers: ['define', 'Template'] },
      { source: 'app',       default: 'App' },
      { source: 'react',     default: 'React', specifiers: ['useMemo', 'useEffect'] },
      { source: 'lodash',    default: '_' }
    ]

    let sourceAliases = [
      [/\/framework$/, 'framework']
    ]

    let classes     = Object.keys(this._importNames).map(className => this.codebase.getClassForClassName(className)),
        sourceFiles = _.uniq(classes.filter(cls => !cls.discard).map(c => c.sourceFile)),
        imports     = {}

    libImports.forEach(lib => {
      let $default   = (lib.default && libraries.includes(lib.default)) ? lib.default : null,
          specifiers = _.intersection(lib.specifiers, libraries)

      if($default || specifiers.length){
        imports[lib.source] = { default: $default, specifiers }
      }
    })

    sourceFiles.forEach(sourceFile => {
      let source = getRelativePath(this.codeFilePath, sourceFile.importFilePath).replace(/\.js$/, '').replace(/\/index$/, '')

      sourceAliases.forEach(([check, alias]) => {
        if(check.test(source)){
          source = alias
        }
      })

      let specifiers = _.intersection(sourceFile.undiscardedClasses, classes)
        .map(cls => this.getImportNameForClassName(cls.className))
        .sort((s1, s2) => s1.localeCompare(s2))

      if(sourceFile.undiscardedClasses.length <= 1){
        imports[source] = { default: specifiers[0] }
        return
      }

      imports[source]
        ? imports[source].specifiers = [...imports[source].specifiers, ...specifiers]
        : imports[source] = { specifiers }
    })

    let importOrder = [...libImports.map(({ source }) => source), ...sourceAliases.map(a => a[1])].reverse()

    imports = Object.keys(imports)
      .map(source => ({ source, ...imports[source] }))
      .sort(({ source: s1 }, { source: s2 }) => {
        let order = importOrder.indexOf(s2) - importOrder.indexOf(s1)
        return order === 0 ? s1.localeCompare(s2) : order
      })

    return code(...imports.map(imp => {
      let specifiers = _.compact([
        imp.default,
        (imp.specifiers || []).length ? `{ ${imp.specifiers.join(', ')} }` : null
      ]).join(', ')

      return `import ${specifiers} from '${imp.source}'`
    }))
  }

  renameConfigCalls(ast){
    let classes = [
      ...this.classes,
      ...Object.keys(this._importNames).map(className => this.codebase.getClassForClassName(className))
    ]

    let accessors = _.uniq(classes.reduce((accessors, cls) => [...accessors, ...cls.localAndInheritedAccessors], []))

    visit(ast, {
      visitCallExpression: function(path){
        let { node } = path

        if(Ast.isMemberExpression(node.callee)){
          let callee     = Ast.toString(node.callee).split('.'),
              call       = callee[callee.length - 1],
              isGetter   = call.startsWith('get'),
              isSetter   = call.startsWith('set'),
              configName = (call.slice(3)[0] || '').toLowerCase() + call.slice(4)

          if((!isGetter && !isSetter) || !accessors.includes(configName)){
            this.traverse(path)
            return
          }

          callee = [...callee.slice(0, -1), configName].join('.')

          if(isGetter && node.arguments.length === 0){
            path.replace(Ast.from(callee))
          }

          if(isSetter && node.arguments.length === 1){
            path.replace(Ast.from(`${callee} = ${Ast.toString(node.arguments[0])}`))
          }
        }

        this.traverse(path)
      }
    })
  }

  removeEmptyClasses(){
    let asts = this.classes.map(cls => cls.ast)

    visit(this._ast, {
      visitCallExpression: function(path){
        let { node } = path
        let [className, classData] = node.arguments

        let emptyClass = (
          Ast.getMethodCall(node) === 'Ext.define' &&
          node.arguments.length === 2 &&
          Ast.isString(className) &&
          asts.includes(classData) &&
          Ast.getProperties(classData).length === 0
        )

        if(emptyClass){
          path.prune()
        }

        this.traverse(path)
      }
    })
  }

  replaceClassNames(code){
    this.codebase.classRe.forEach(({ re, cls }) => {
      code = code.replace(re, (match, name, extra) => (this.getImportNameForClassName(cls.className) || name) + extra)
    })

    return code
  }

  getImportNameForAlias(alias){
    let className = this.codebase.getClassNameForAlias(alias)
    return className ? this.getImportNameForClassName(className) : null
  }

  getImportNameForClassName(className){
    return this._importNames[className]
  }

  getExportNameForClassName(className){
    if(!this._initializedExportNames){
      this.classes.forEach(cls => this._exportNames[cls.className] = this._getExportName(cls))
      this._initializedExportNames = true
    }

    return this._exportNames[className]
  }

  init(){
    let classes = _.uniq([
      ...this.classesUsed,
      ...(_.flattenDeep(this.classes.map(cls => cls.assimilatedClasses.map(cls => cls.sourceFile.classesUsed))))
    ])

    let importNames = _.groupBy(classes, cls => cls.exportName)

    Object.keys(importNames).forEach(importName => {
      let classes = importNames[importName],
          exports = this.undiscardedClasses.map(cls => cls.exportName)

      classes.forEach((cls, i) => {
        this._importNames[cls.className] = importName + ((classes.length > 1 || exports.includes(cls.exportName)) ? (i + 1) : '')
      })
    })
  }

  _getExportName(cls){
    if(!cls.classAliases.length){
      return cls.className.split('.').reverse().slice(0, -1).map(p => p[0].toUpperCase() + p.slice(1)).join('')
    }

    let parts      = cls.classAliases[0].split('.'),
        namespace  = parts.slice(0, parts.length - 1).map(p => _.capitalize(p)).join(''),
        alias      = _.capitalize(parts[parts.length - 1].replace(/.*-/, '')),
        exportName = this.codebase.capitalize(alias),
        suffix     = { 'viewmodel': 'Model' }[namespace] || namespace

    return exportName + (suffix === 'Widget' ? '' : suffix)
  }
}