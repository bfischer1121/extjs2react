import _ from 'lodash'
import recast from 'recast'
import { builders as b, visit } from 'ast-types'
import { Ast, code, getRelativePath, logError } from './Util'
import ExtJSClass from './ExtJSClass'

export default class SourceFile{
  classes = []

  _importNames = {}

  unknownAliases    = []
  unknownClassNames = []

  static async factory(config){
    let sourceFile = new this(config)

    if(sourceFile.parseable){
      await sourceFile.processAST()
    }

    return sourceFile
  }

  static fromSnapshot(codebase, { codeFilePath, importFilePath, parseable, classes }){
    let sourceFile = new this({ codebase, codeFilePath, importFilePath })

    sourceFile.fromSnapshot = true

    sourceFile.parseable = parseable
    sourceFile.classes   = classes.map(snapshot => ExtJSClass.fromSnapshot(sourceFile, snapshot))

    return sourceFile
  }

  toSnapshot(){
    return {
      codeFilePath   : this.codeFilePath,
      importFilePath : this.importFilePath,
      parseable      : this.parseable,
      classes        : this.classes.map(cls => cls.toSnapshot())
    }
  }

  constructor({ codebase, codeFilePath, importFilePath, source, ast }){
    this._codebase = codebase
    this._source   = source
    this._ast      = ast

    this.codeFilePath   = codeFilePath
    this.importFilePath = importFilePath
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
      this._parseable = this._getMatches(/Ext\.define\(\s*['|"][^'|"]+['|"]/g).length > 0
    }

    return this._parseable
  }

  set parseable(parseable){
    this._parseable = parseable
  }

  get _astIsPerfect(){
    if(_.isUndefined(this.__astIsPerfect)){
      this.__astIsPerfect = (Ast.toString(this._ast) === this._source)
    }

    return this.__astIsPerfect
  }

  get _importsCode(){
    let classes     = Object.keys(this._importNames).map(className => this._codebase.getClassForClassName(className)),
        sourceFiles = _.uniq(classes.map(c => c.sourceFile))

    let imports = sourceFiles.map(sourceFile => {
      let importNames = _.intersection(sourceFile.classes, classes).map(cls => this.getImportNameForClassName(cls.className)),
          specifiers  = sourceFile.classes.length > 1 ? '{ ' + importNames.join(', ') + ' }' : importNames[0],
          source      = getRelativePath(this.codeFilePath, sourceFile.importFilePath).replace(/\.js$/, '')

      return `import ${specifiers} from '${source}'`
    })

    return code(...imports)
  }

  get _exportsCode(){
    return this.classes.map(cls => cls.transpile()).join('\n\n')
  }

  get _aliasesUsed(){
    return _.uniq(this.classes.reduce((aliases, cls) => ([...aliases, ...cls.aliasesUsed]), []))
  }

  get _classNamesUsed(){
    let internalCls = this.classes.map(cls => cls.className),
        externalCls = this._codebase.classRe.reduce((classes, re) => [...classes, ...(this._getMatches(re).map(match => match[1]))], [])

    return _.uniq(_.difference(externalCls, internalCls))
  }

  async processAST(){
    let processClassDefinition = node => {
      let [className, data, createdFn] = node.arguments

      if(!Ast.isString(className) || !Ast.isObject(data)){
        logError(`Error parsing Ext.define call (${this.codeFilePath}): Expected first and second arguments to be a string and object, respectively`)
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

  transpile(){
    if(this.fromSnapshot){
      throw 'Cannot transpile from snapshot'
    }

    return [
      Ast.toString(this._ast),
      this._importsCode,
      this._exportsCode
    ].join('\n\n')
  }

  getImportNameForAlias(alias){
    let className = this._codebase.getClassNameForAlias(alias)
    return className ? this.getImportNameForClassName(className) : null
  }

  getImportNameForClassName(className){
    return this._importNames[className]
  }

  initImports(){
    let aliases    = this._aliasesUsed,
        classNames = this._classNamesUsed,
        classes    = []

    aliases.forEach(alias => {
      let className = this._codebase.getClassNameForAlias(alias)
      className ? classNames.push(className) : this.unknownAliases.push(alias)
    })

    classNames.forEach(className => {
      let cls = this._codebase.getClassForClassName(className)
      cls ? classes.push(cls) : this.unknownClassNames.push(className)
    })

    classes = _.uniq(classes)

    let importNames = _.groupBy(classes, cls => cls.exportName)

    Object.keys(importNames).forEach(importName => {
      let classes = importNames[importName],
          exports = this.classes.map(cls => cls.exportName)

      classes.forEach((cls, i) => {
        this._importNames[cls.className] = importName + ((classes.length > 1 || exports.includes(cls.exportName)) ? (i + 1) : '')
      })
    })
  }

  getExportName(cls){
    if(!this.classes.includes(cls)){
      throw 'getExportName should be called via ExtJSClass'
    }

    if(!cls.classAliases.length){
      return cls.unqualifiedClassName
    }

    let parts      = cls.classAliases[0].split('.'),
        namespace  = parts.slice(0, parts.length - 1).join('.'),
        alias      = _.capitalize(parts[parts.length - 1].replace(/.*-/, '')),
        exportName = this._codebase.words.reduce((alias, [word, wordRe]) => alias.replace(wordRe, word), alias)

    let suffix = {
      'controller' : 'Controller',
      'viewmodel'  : 'Model',
      'proxy'      : 'Proxy',
      'store'      : 'Store'
    }[namespace] || ''

    return exportName + suffix
  }

  _getMatches(regExp){
    let matches = [],
        match

    while(match = regExp.exec(this._source)){
      matches.push(match)
    }

    return matches
  }
}