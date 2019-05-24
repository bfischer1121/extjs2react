import _ from 'lodash'
import { builders as b } from 'ast-types'
import Ast from './Ast'

class Component{
  untransformed = {}

  components = {
    widget: {
      type: 'div'
    },

    component: {
      extends: 'widget',

      props: {
        html: (value, cmp) => {
          if(Ast.isString(value)){
            cmp.children.push(b.jsxText(value.value))
            return null
          }
        }
      }
    },

    container: {
      extends: 'component'
    },

    panel: {
      extends: 'container'
    },

    button: {
      extends: 'component',
      type: 'Button'
    }
  }

  convert(xtype, props){
    this.untransformed[xtype] = this.untransformed[xtype] || { instanceCount: 0, propCount: {} }
    this.untransformed[xtype].instanceCount = this.untransformed[xtype].instanceCount + 1

    props.filter(({ name }) => !['itemId', 'className'].includes(name)).forEach(prop => {
      if(!(this.components[xtype] || {})[prop.name]){
        this.untransformed[xtype].propCount[prop.name] = (this.untransformed[xtype].propCount[prop.name] || 0) + 1
      }
    })

    if(!this.components[xtype]){
      return null
    }

    let cmp = this._getSelfAndAncestors(xtype).reverse().reduce((cmp, xtype) => {
      let { type = cmp.type, props = {} } = this.components[xtype] || {}

      cmp.type = type

      cmp.props = _.compact(cmp.props.map(prop => {
        let transformed = props[prop.name] ? props[prop.name](prop.value, cmp) : undefined
        return typeof transformed === 'undefined' ? prop : transformed
      }))

      return cmp
    }, { type: 'div', props, children: [] })

    cmp.html = ['div'].includes(cmp.type)

    return cmp
  }

  _getSelfAndAncestors(xtype){
    const ancestors = []

    for(let cmp = xtype; cmp; cmp = (this.components[cmp] || {}).extends){
      ancestors.push(cmp)
    }

    return ancestors
  }
}

export default new Component()