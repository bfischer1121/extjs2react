import _ from 'lodash'
import recast from 'recast'
import { builders as b, visit } from 'ast-types'
import { Ast, code, getRelativePath, logError } from './Util'
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
      }
    })
  }

  getUnparsedCode(){
    if(this._astIsPerfect){
      this.classes.forEach(cls => cls.pruneAST())
      this.removeEmptyClasses()
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
        exports   = _.compact(clsCode.map(({ exportCode }) => exportCode)),
        classes   = _.compact(clsCode.map(({ classCode }) => classCode)),
        libraries = _.uniq(this.undiscardedClasses.reduce((lib, cls) => [...lib, ...cls.libraries], []))

    classes = classes.map(code => {
      code = this.replaceClassNames(code)

      let ast = Ast.parseWithJSX(code)

      this.renameConfigCalls(ast)

      if(hooks.afterTranspile){
        libraries.push(...hooks.afterTranspile(ast))
      }

      return Ast.toString(ast)
    })

    let imports = this.getImportsCode(_.uniq(libraries))

    let code = _.compact([
      imports,
      ...classes,
      ...exports
    ]).join('\n\n').trim()

    if(hooks.beforeSave){
      code = hooks.beforeSave(code)
    }

    return _.compact([this.getUnparsedCode(), code]).join('\n\n')
  }

  getImportsCode(libraries){
    let libStatements = [
      ['App',   `import App from 'app'`],
      ['React', `import React, { Component } from 'react'`],
      ['_',   `import _ from 'lodash'`]
    ]

    let classes     = Object.keys(this._importNames).map(className => this.codebase.getClassForClassName(className)),
        sourceFiles = _.uniq(classes.filter(cls => !cls.discard).map(c => c.sourceFile)),
        imports     = libStatements.filter(([lib]) => libraries.includes(lib)).map(([lib, statement]) => statement)

    sourceFiles.forEach(sourceFile => {
      let importNames = _.intersection(sourceFile.undiscardedClasses, classes).map(cls => this.getImportNameForClassName(cls.className)),
          specifiers  = sourceFile.undiscardedClasses.length > 1 ? '{ ' + importNames.join(', ') + ' }' : importNames[0],
          source      = getRelativePath(this.codeFilePath, sourceFile.importFilePath).replace(/\.js$/, '').replace(/\/index$/, '')

      imports.push(`import ${specifiers} from '${source}'`)
    })

    return code(...imports)
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
      code = code.replace(re, (match, name, extra) => this.getImportNameForClassName(cls.className) + extra)
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
      let name = cls.className.split('.').reverse().slice(0, -1).map(p => p[0].toUpperCase() + p.slice(1)).join('')
      return name === 'Component' ? 'ExtJSComponent' : name
    }

    let parts      = cls.classAliases[0].split('.'),
        namespace  = parts.slice(0, parts.length - 1).map(p => _.capitalize(p)).join(''),
        alias      = _.capitalize(parts[parts.length - 1].replace(/.*-/, '')),
        exportName = this.codebase.capitalize(alias),
        suffix     = { 'viewmodel': 'Model' }[namespace] || namespace,
        name       = exportName + (suffix === 'Widget' ? '' : suffix)

    return name === 'Component' ? 'ExtJSComponent' : name
  }
}