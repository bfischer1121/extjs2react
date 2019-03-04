import _ from 'lodash'
import recast from 'recast'
import { builders as b, visit } from 'ast-types'
import { Ast, code, getRelativePath, logError } from './Util'
import ExtJSClass from './ExtJSClass'

export default class SourceFile{
  classes = []

  importNames = {}

  unknownAliases    = []
  unknownClassNames = []

  static async factory(config){
    let sourceFile = new this(config)

    if(sourceFile.parseable){
      await sourceFile.processAST()
    }

    return sourceFile
  }

  constructor({ codebase, codeFilePath, importFilePath, source, ast, forceParse }){
    this._codebase       = codebase
    this._originalSource = source

    this.codeFilePath   = codeFilePath
    this.importFilePath = importFilePath
    this.ast            = ast

    this.parseable = this._getMatches(/Ext\.define\(\s*['|"][^'|"]+['|"]/g).length > 0

    if(this.parseable){
      try{
        this.ast = this.ast || recast.parse(source)
      }
      catch(e){
        throw `Error parsing source file (${filePath}): ${e}`
      }

      this.parseable  = forceParse || true
      this.perfectAst = (Ast.toString(this.ast) === source)
    }
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

    visit(this.ast, {
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
    return [
      Ast.toString(this.ast),
      this.getImportsCode(),
      this.getExportsCode()
    ].join('\n\n')
  }

  getImportsCode(){
    let classes   = Object.keys(this.importNames).map(className => this._codebase.getClassForClassName(className)),
        files     = _.groupBy(classes, cls => cls.sourceFile.importFilePath),
        filePaths = Object.keys(files).reverse()

    let imports = filePaths.map(filePath => {
      let importNames = files[filePath].map(cls => this.getImportNameForClassName(cls.className)),
          specifiers  = importNames.length > 1 ? '{ ' + importNames.join(', ') + ' }' : importNames[0],
          source      = getRelativePath(this.codeFilePath, filePath).replace(/\.js$/, '')

      return `import ${specifiers} from '${source}'`
    })

    return code(...imports)
  }

  getExportsCode(){
    return this.classes.map(cls => cls.transpile()).join('\n\n')
  }

  getImportNameForAlias(alias){
    let className = this._codebase.getClassNameForAlias(alias)
    return className ? this.getImportNameForClassName(className) : null
  }

  getImportNameForClassName(className){
    return this.importNames[className]
  }

  async initImports(){
    let aliases    = this.getAliasesUsed(),
        classNames = this.getClassNamesUsed(),
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

    let importNames = _.groupBy(classes, cls => cls.getExportName())

    Object.keys(importNames).forEach(importName => {
      let classes = importNames[importName],
          exports = this.classes.map(cls => cls.getExportName())

      classes.forEach((cls, i) => {
        this.importNames[cls.className] = importName + ((classes.length > 1 || exports.includes(cls.getExportName())) ? (i + 1) : '')
      })
    })
  }

  getExportName(cls){
    if(!this.classes.includes(cls)){
      throw 'getExportName should be called via ExtJSClass'
    }

    if(!cls.classAliases.length){
      return cls.getUnqualifiedClassName()
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

  getAliasesUsed(){
    return _.uniq(this.classes.reduce((aliases, cls) => ([...aliases, ...cls.getAliasesUsed()]), []))
  }

  getClassNamesUsed(){
    let internalCls = this.classes.map(cls => cls.className),
        externalCls = this._codebase.classRe.reduce((classes, re) => [...classes, ...(this._getMatches(re).map(match => match[1]))], [])

    return _.uniq(_.difference(externalCls, internalCls))
  }

  _getMatches(regExp){
    let matches = [],
        match

    while(match = regExp.exec(this._originalSource)){
      matches.push(match)
    }

    return matches
  }
}