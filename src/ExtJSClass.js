import _ from 'lodash'
import recast from 'recast'
import { namedTypes as t, builders as b, visit } from 'ast-types'
import { Ast, logError, getConfig } from './Util'
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

    let normalize = config => _.compact(_.isArray(config) ? config : [config]),
        xtypes    = normalize(Ast.getConfig(this.ast, 'xtype')).map(xtype => `widget.${xtype}`),
        aliases   = normalize(Ast.getConfig(this.ast, 'alias'))

    this.parentClassName = Ast.getConfig(this.ast, 'extend')
    this.classAliases    = _.uniq([...xtypes, ...aliases])
  }

  static getUnqualifiedClassName(className){
    let parts = className.split('.')
    return parts[parts.length - 1]
  }

  getUnqualifiedClassName(){
    return ExtJSClass.getUnqualifiedClassName(this.className)
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

    let handleNode = (aliases, node, configName) => {
      let prefix = {
        xtype      : 'widget.',
        viewModel  : 'viewmodel.',
        controller : 'controller.'
      }[configName] || ''

      let { value } = node

      if(t.Literal.check(value)){
        return [...aliases, prefix + value.value]
      }

      if(configName === 'viewModel' && t.ObjectExpression.check(value)){
        let vmType = value.properties.find(p => p.key.name === 'type')
        return vmType ? [...aliases, prefix + vmType.value.value] : aliases
      }

      if(t.ConditionalExpression.check(value)){
        return handleNode(handleNode(aliases, value.consequent, configName), value.alternate, configName)
      }

      logError(`Error parsing ${configName} (${this.sourceFile.filePath})`)
      return aliases
    }

    let aliases = nodes.reduce((aliases, node) => handleNode(aliases, node, node.key.name), [])

    return _.uniq(_.difference(aliases, this.classAliases))
  }

  getExportName(){
    return this.sourceFile.getExportName(this)
  }

  getES6Class(){
    // controller, viewModel, cls, items, listeners, bind
    return b.classDeclaration(
      b.identifier(this.getExportName()),
      b.classBody([this.getRenderFn()]),
      this.parentClass ? b.identifier(this.parentClass.getUnqualifiedClassName()) : null
    )
  }

  getRenderFn(){
    let identifier = b.jsxIdentifier(this.getUnqualifiedClassName()),
        props      = [],
        items      = _.compact((Ast.getConfig(this.ast, 'items') || []).map(item => this.getJSXFromConfig(item)))

    let jsx = b.jsxElement(
      b.jsxOpeningElement(identifier, props),
      b.jsxClosingElement(identifier),
      items,
      items.length === 0
    )

    return b.classMethod(
      'method',
      b.identifier('render'),
      [b.identifier('props')],
      b.blockStatement([
        b.returnStatement(jsx)
      ])
    )
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