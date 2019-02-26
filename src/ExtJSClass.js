import _ from 'lodash'
import { namedTypes, visit } from 'ast-types'
import { logError } from './Util'

export default class ExtJSClass{
  parentClassName = null
  parentClass     = null

  className  = null
  classAlias = null

  imports = []
  props   = {}
  state   = {}

  constructor(source, className, ast, createdFn){
    this.source    = source
    this.className = className
    this.ast       = ast
    this.createdFn = createdFn

    this.process('extend', 'xtype', 'alias')
  }

  getFileSearchRegExp(){
    return new RegExp(`(${this.className})\\W+?`, 'g')
  }

  getAliasesUsed(){
    let nodes = []

    visit(this.ast, {
      visitObjectExpression: function(path){
        let configNames = ['xtype', 'alias', 'controller', 'viewModel']
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

      if(namedTypes.Literal.check(value)){
        return [...aliases, prefix + value.value]
      }

      if(configName === 'viewModel' && namedTypes.ObjectExpression.check(value)){
        let vmType = value.properties.find(p => p.key.name === 'type')
        return vmType ? [...aliases, prefix + vmType.value.value] : aliases
      }

      if(namedTypes.ConditionalExpression.check(value)){
        return handleNode(handleNode(aliases, value.consequent, configName), value.alternate, configName)
      }

      logError(`Error parsing ${configName} (${this.source.filePath})`)
      return aliases
    }

    return _.uniq(nodes.reduce((aliases, node) => handleNode(aliases, node, node.key.name), []))
  }

  process(...configs){
    let data = []

    this.ast.properties.forEach(node => {
      let name = node.key.name
      configs.includes(name) ? this[name](node.value) : data.push(node)
    })

    this.ast.properties = data
  }

  extend(value){
    this.parentClassName = value.value
  }

  xtype(value){
    this.classAlias = `widget.${value.value}`
  }

  alias(value){
    this.classAlias = value.value
  }

  controller(value){
    
  }

  viewModel(value){
    
  }

  cls(value){
    
  }

  items(value){
    
  }

  listeners(value){
    
  }

  bind(value){
    
  }
}