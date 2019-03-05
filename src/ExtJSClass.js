import _ from 'lodash'
import recast from 'recast'
import prettier from 'prettier'
import { namedTypes as t, builders as b, visit } from 'ast-types'
import { Ast, code, logError, getConfig } from './Util'
import SourceFile from './SourceFile'

export default class ExtJSClass{
  parentClass = null

  className = null

  props = {}
  state = {}

  extractedProps = {}

  static fromSnapshot(sourceFile, { className, exportName, parentClassName, classAliases, aliasesUsed, methodCalls }){
    let cls = new this(sourceFile, className)

    cls.fromSnapshot = true

    cls.exportName      = exportName
    cls.parentClassName = parentClassName
    cls.classAliases    = classAliases
    cls.aliasesUsed     = aliasesUsed
    cls.methodCalls     = methodCalls

    return cls
  }

  toSnapshot(){
    return {
      className       : this.className,
      exportName      : this.exportName,
      parentClassName : this.parentClassName,
      classAliases    : this.classAliases,
      aliasesUsed     : this.aliasesUsed,
      methodCalls     : this.methodCalls
    }
  }

  constructor(sourceFile, className, ast, createdFn){
    this.sourceFile = sourceFile
    this.className  = className
    this._ast       = ast
    this._createdFn = createdFn
  }

  get parentClassName(){
    if(_.isUndefined(this._parentClassName)){
      this._parentClassName = Ast.getConfig(this._ast, 'extend')
    }

    return this._parentClassName
  }

  set parentClassName(name){
    this._parentClassName = name || null
  }

  get classAliases(){
    if(_.isUndefined(this._classAliases)){
      this._classAliases = _.uniq(this._getAliasesFromNodes(Ast.getProperties(this._ast, ['xtype', 'alias'])))
    }

    return this._classAliases
  }

  set classAliases(aliases){
    this._classAliases = aliases
  }

  get unqualifiedClassName(){
    let parts = this.className.split('.')
    return parts[parts.length - 1]
  }

  get fileSearchRegExp(){
    return new RegExp(`(${this.className})\\W+?`, 'g')
  }

  get methodCalls(){
    if(_.isUndefined(this._methodCalls)){
      let calls = []

      visit(this._ast, {
        visitCallExpression: function(path){
          calls.push(Ast.getMethodCall(path.node))
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

  get aliasesUsed(){
    if(_.isUndefined(this._aliasesUsed)){
      let nodes       = [],
          configNames = ['xtype', 'alias', 'controller', 'viewModel']

      visit(this._ast, {
        visitObjectExpression: function(path){
          nodes.push(...path.node.properties.filter(p => configNames.includes(p.key.name)))
          this.traverse(path)
        }
      })

      this._aliasesUsed = _.uniq(_.difference(this._getAliasesFromNodes(nodes), this.classAliases))
    }

    return this._aliasesUsed
  }

  set aliasesUsed(aliases){
    this._aliasesUsed = aliases
  }

  get exportName(){
    if(_.isUndefined(this._exportName)){
      this._exportName = this.sourceFile.getExportName(this)
    }

    return this._exportName
  }

  set exportName(name){
    this._exportName = name
  }

  _getAliasesFromNodes(nodes){
    let handleNode = (aliases, node, configName) => {
      let prefix = {
        xtype      : 'widget.',
        viewModel  : 'viewmodel.',
        controller : 'controller.'
      }[configName] || ''

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
        return node.elements.reduce((aliases, node) => handleNode(aliases, node, configName), aliases)
      }

      if(Ast.isObject(node) && ['controller', 'viewModel'].includes(configName)){
        let typeNode = Ast.getProperty(node, 'type')
        return typeNode ? handleNode(aliases, typeNode, configName) : aliases
      }

      if(Ast.isTernary(node)){
        return [node.consequent, node.alternate].reduce((aliases, node) => handleNode(aliases, node, configName), aliases)
      }

      console.log(`Error parsing ${configName} (${this.className}): ${Ast.toString(node)}`) // logError

      return aliases
    }

    return nodes.reduce((aliases, node) => handleNode(aliases, node.value, node.key.name), [])
  }

  transpile(type = 'ES6'){
    return type === 'reactified'
      ? this.getReactifiedClass()
      : this.getES6Class()
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

  getES6Class(){
    let exportCode  = this.sourceFile.classes.length === 1 ? 'export default' : 'export',
        className   = this.exportName,
        parentName  = this.parentClass ? this.sourceFile.getImportNameForClassName(this.parentClass.className) : null,
        extendsCode = parentName ? ` extends ${parentName}` : '',
        methods     = [this.getRenderFn()]

    // controller, viewModel, cls, items, listeners, bind
    return code(`${exportCode} class ${className}${extendsCode}{`, methods, '}')
  }

  getRenderFn(){
    let identifier = b.jsxIdentifier(this.exportName),
        props      = [],
        items      = _.compact((Ast.getConfig(this._ast, 'items') || []).map(item => this.getJSXFromConfig(item)))

    let jsx = b.jsxElement(
      b.jsxOpeningElement(identifier, props),
      b.jsxClosingElement(identifier),
      items,
      items.length === 0
    )

    let extractedProps = Object.keys(this.extractedProps).map(name => (
      `const ${name} = ${Ast.toString(this.extractedProps[name])}`
    )).join('\n\n')

    return code(
      'render(props){',
      [
        extractedProps + (extractedProps.length ? '\n' : ''),
        'return (',
        [this.getCodeFromJSX(jsx)],
        ')',
      ],
      '}'
    )
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

  getPropsFromConfig(config){
    let getPropName = configName => ({ 'cls': 'className' }[configName] || configName)

    return Ast.getPropertiesExcept(config, 'extend', 'xtype', 'items').map(({ key, value }) => {
      let name = getPropName(key.name || key.value),
          prop = value => b.jsxAttribute(b.jsxIdentifier(name), value)

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
  }

  _shouldExtractJSXValue(node){
    let checkRe = /<[^>]+>|,|\./ig,
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