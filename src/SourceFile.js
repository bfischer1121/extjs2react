import _ from 'lodash'
import recast from 'recast'
import { builders as b, visit } from 'ast-types'
import { Ast, getRelativePath, logError } from './Util'
import ExtJSClass from './ExtJSClass'

export default class SourceFile{
  imports = []
  classes = []

  importNames = {}

  unknownAliases    = []
  unknownClassNames = []

  constructor(codebase, filePath, source){
    this.codebase       = codebase
    this.filePath       = filePath
    this.originalSource = source
    this.parseable      = this._getMatches(/Ext\.define\(\s*['|"][^'|"]+['|"]/g).length > 0

    if(this.parseable){
      try{
        this.ast = recast.parse(source)
      }
      catch(e){
        throw `Error parsing source file (${filePath}): ${e}`
      }

      this.parseable = (this.toCode() === source)
      this.process()
    }
  }

  async process(){
    let processImport = node => this.imports.push(node)

    let processClassDefinition = node => {
      let [className, data, createdFn] = node.arguments

      if(!Ast.isString(className) || !Ast.isObject(data)){
        logError(`Error parsing Ext.define call (${this.filePath}): Expected first and second arguments to be a string and object, respectively`)
        return
      }

      this.classes.push(new ExtJSClass(this, className.value, data, createdFn))
    }

    visit(this.ast, {
      visitImportDeclaration: function(path){
        processImport(path.node)
        this.traverse(path)
      },

      visitCallExpression: function(path){
        let { node } = path

        if(Ast.getMethodCall(node) === 'Ext.define'){
          processClassDefinition(node)
        }

        this.traverse(path)
      }
    })
  }

  toCode(){
    return this.parseable ? recast.print(this.ast).code : this.originalSource
  }

  getImportNameForAlias(alias){
    let className = this.codebase.getClassNameForAlias(alias)
    return className ? this.getImportNameForClassName(className) : null
  }

  getImportNameForClassName(className){
    return this.importNames[className]
  }

  // [{ className: 'Grid', xtype: 'grid' }]
  async getFrameworkImports(imports){
    let reactor = b.importDeclaration([b.importSpecifier(b.identifier('reactify'))], '@extjs/reactor')

    let classes = b.variableDeclaration('const', imports.map(({ className, xtype }) => (
      b.variableDeclarator(
        b.identifier(className),
        b.callExpression(b.identifier('reactify'), [xtype])
      )
    )))

    return [reactor, ...classes]
  }

  async initImports(){
    let aliases    = this.getAliasesUsed(),
        classNames = this.getClassNamesUsed(),
        classes    = []

    aliases.forEach(alias => {
      let className = this.codebase.getClassNameForAlias(alias)
      className ? classNames.push(className) : this.unknownAliases.push(alias)
    })

    classNames.forEach(className => {
      let cls = this.codebase.getClassForClassName(className)
      cls ? classes.push(cls) : this.unknownClassNames.push(className)
    })

    classes = _.uniq(classes)

    let importNames = _.groupBy(classes, cls => cls.getExportName())

    Object.keys(importNames).forEach(importName => {
      let classes = importNames[importName]

      classes.forEach((cls, i) => {
        this.importNames[cls.className] = importName + (classes.length === 1 ? '' : (i + 1))
      })
    })
  }

  getImports(){
    let classes   = Object.keys(this.importNames).map(className => this.codebase.getClassForClassName(className)),
        files     = _.groupBy(classes, cls => cls.sourceFile.filePath),
        filePaths = Object.keys(files).reverse(),
        extraLine = (this.imports.length === 0)

    return filePaths.map((filePath, i) => {
      let importNames = files[filePath].map(cls => this.importNames[cls.className]),
          specifiers  = importNames.length > 1 ? '{ ' + importNames.join(', ') + ' }' : importNames[0],
          source      = getRelativePath(this.filePath, filePath).replace(/\.js$/, ''),
          suffix      = (extraLine && i + 1 === filePaths.length) ? '\n\n' : '\n'

      return recast.parse(`import ${specifiers} from '${source}'${suffix}`).program.body[0]
    })
  }

  getExportName(cls){
    if(!this.classes.includes(cls)){
      throw 'getExportName should be called via ExtJSClass'
    }

    if(!cls.classAliases.length){
      return cls.getUnqualifiedClassName()
    }

    let parts     = cls.classAliases[0].split('.'),
        namespace = parts.slice(0, parts.length - 1).join('.'),
        alias     = _.capitalize(parts[parts.length - 1].replace(/.*-/, ''))

    return this.codebase.words.reduce((alias, [word, wordRe]) => alias.replace(wordRe, word), alias)
  }

  getAliasesUsed(){
    return _.uniq(this.classes.reduce((aliases, cls) => ([...aliases, ...cls.getAliasesUsed()]), []))
  }

  getClassNamesUsed(){
    let internalCls = this.classes.map(cls => cls.className),
        externalCls = this.codebase.classRe.reduce((classes, re) => [...classes, ...(this._getMatches(re).map(match => match[1]))], [])

    return _.uniq(_.difference(externalCls, internalCls))
  }

  _getMatches(regExp){
    let matches = [],
        match

    while(match = regExp.exec(this.originalSource)){
      matches.push(match)
    }

    return matches
  }
}