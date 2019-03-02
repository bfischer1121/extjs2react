import _ from 'lodash'
import recast from 'recast'
import { namedTypes as t, builders as b, visit } from 'ast-types'
import { Ast, code, logError, getConfig } from './Util'
import SourceFile from './SourceFile'

export default class ExtJSClass{
  parentClassName = null
  parentClass     = null

  className    = null
  classAliases = []

  props = {}
  state = {}

  constructor(sourceFile, className, ast, createdFn){
    this.sourceFile = sourceFile
    this.className  = className
    this.ast        = ast
    this.createdFn  = createdFn

    this.parentClassName = Ast.getConfig(this.ast, 'extend')
    this.classAliases    = _.uniq(this.getAliasesFromNodes(Ast.getProperties(this.ast, ['xtype', 'alias'])))
  }

  getUnqualifiedClassName(){
    let parts = this.className.split('.')
    return parts[parts.length - 1]
  }

  getFileSearchRegExp(){
    return new RegExp(`(${this.className})\\W+?`, 'g')
  }

  getAliasesUsed(){
    let nodes       = [],
        configNames = ['xtype', 'alias', 'controller', 'viewModel']

    visit(this.ast, {
      visitObjectExpression: function(path){
        nodes.push(...path.node.properties.filter(p => configNames.includes(p.key.name)))
        this.traverse(path)
      }
    })

    return _.uniq(_.difference(this.getAliasesFromNodes(nodes), this.classAliases))
  }

  getAliasesFromNodes(nodes){
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

      if(t.Literal.check(node) && _.isString(node.value)){
        return [...aliases, prefix + node.value]
      }

      if(t.Literal.check(node) && _.isNull(node.value)){
        return aliases
      }

      if(t.ArrayExpression.check(node) && ['xtype', 'alias'].includes(configName)){
        return node.elements.reduce((aliases, node) => handleNode(aliases, node, configName), aliases)
      }

      if(t.ObjectExpression.check(node) && ['controller', 'viewModel'].includes(configName)){
        let typeNode = Ast.getProperty(node, 'type')
        return typeNode ? handleNode(aliases, typeNode, configName) : aliases
      }

      if(t.ConditionalExpression.check(node)){
        return [node.consequent, node.alternate].reduce((aliases, node) => handleNode(aliases, node, configName), aliases)
      }

      console.log(`Error parsing ${configName} (${this.className}): ${Ast.toString(node)}`) // logError

      return aliases
    }

    return nodes.reduce((aliases, node) => handleNode(aliases, node.value, node.key.name), [])
  }

  getExportName(){
    return this.sourceFile.getExportName(this)
  }

  transpile(){
    return this.getES6Class()
  }

  getES6Class(){
    let exportCode = this.sourceFile.classes.length === 1 ? 'export default' : 'export',
        className   = this.getExportName(),
        parentName  = this.parentClass ? this.sourceFile.getImportNameForClassName(this.parentClass.className) : null,
        extendsCode = parentName ? ` extends ${parentName}` : '',
        methods     = [this.getRenderFn()]

    // controller, viewModel, cls, items, listeners, bind
    return code(`${exportCode} class ${className}${extendsCode}{`, methods, '}')
  }

  getRenderFn(){
    let identifier = b.jsxIdentifier(this.getExportName()),
        props      = [],
        items      = _.compact((Ast.getConfig(this.ast, 'items') || []).map(item => this.getJSXFromConfig(item)))

    let jsx = b.jsxElement(
      b.jsxOpeningElement(identifier, props),
      b.jsxClosingElement(identifier),
      items,
      items.length === 0
    )

    return code('render(props){', [`return ${Ast.toString(jsx)}`], '}')
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
      let prop = value => b.jsxAttribute(b.jsxIdentifier(getPropName(key.name || key.value)), value)

      if(value.type === 'Literal' && _.isString(value.value)){
        return prop(value)
      }

      if(value.type === 'Literal' && _.isBoolean(value.value) && !!value.value){
        return prop(null)
      }

      return prop(b.jsxExpressionContainer(value))
    })
  }
}