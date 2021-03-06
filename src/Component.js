import _ from 'lodash'
import { builders as b } from 'ast-types'
import Ast from './Ast'

class Component{
  untransformed = {}

  components = {
    widget: {
      type: 'div',

      props: {
        disabled: () => {},
      }
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
      type: 'Button',

      props: {
        text: () => {},
        onTap: value => ({ name: 'onClick', value }),
        pressed: value => ({ name: 'active', value })
      }
    },

    segmentedbutton: {
      extends: 'container',
      type: 'ButtonGroup'
    },

    field: {
      extends: 'component',

      props: {
        name: () => {},
        value: () => {}
      }
    },

    inputfield: {
      extends: 'field'
    },

    textfield: {
      extends: 'inputfield',
      type: 'InputGroup',

      props: {
        placeholder: () => {}
      }
    },

    hiddenfield: {
      extends: 'inputfield',
      type: ['input', { type: 'hidden' }]
    },

    textareafield: {
      extends: 'textfield',
      type: 'TextArea',

      props: {
        maxRows: () => ({ name: 'growVertically', value: true })
      }
    },

    sliderfield: {
      extends: 'field'
    },

    singlesliderfield: {
      extends: 'sliderfield'
    },

    togglefield: {
      extends: 'singlesliderfield',
      type: 'Switch'
    },

    filefield: {
      extends: 'filefield',
      type: 'FileInput'
    },

    titlebar: {
      extends: 'container',
      props: {
        title: (value, cmp) => {
          if(Ast.isString(value)){
            cmp.children.push(b.jsxText(value.value))
            return null
          }
        }
      }
    },

    image: {
      extends: 'component',
      type: 'img',
      props: {
        src: () => {},
        html: (value, cmp) => {
          if(Ast.isString(value)){
            cmp.type = 'div'
            cmp.children.push(b.jsxText(value.value))
            return null
          }
        }
      }
    }
  }

  convert(xtype, props){
    this.untransformed[xtype] = this.untransformed[xtype] || { instanceCount: 0, propCount: {} }
    this.untransformed[xtype].instanceCount = this.untransformed[xtype].instanceCount + 1

    props.filter(({ name }) => !['itemId', 'className', 'reference'].includes(name)).forEach(prop => {
      if(!this._getSelfAndAncestors(xtype).find(cmp => ((this.components[cmp] || {}).props || {})[prop.name])){
        this.untransformed[xtype].propCount[prop.name] = (this.untransformed[xtype].propCount[prop.name] || 0) + 1
      }
    })

    if(!this.components[xtype]){
      return null
    }

    const transformValue = value => {
      if(_.isString(value)){
        value = b.literal(value)
      }

      if(_.isBoolean(value)){
        value = b.literal(value)
      }

      return value
    }

    let cmp = this._getSelfAndAncestors(xtype).reverse().reduce((cmp, xtype) => {
      let { type = cmp.type, props = {} } = this.components[xtype] || {}

      if(_.isString(type)){
        cmp.type = type
      }

      if(_.isArray(type)){
        cmp.type = type[0]
        Object.keys(type[1]).forEach(name => {
          cmp.props.unshift({ name, value: transformValue(type[1][name]) })
        })
      }

      cmp.props = _.compact(cmp.props.map(prop => {
        let transformed = props[prop.name] ? props[prop.name](prop.value, cmp) : undefined

        if(transformed && transformed.hasOwnProperty('value')){
          transformed.value = transformValue(transformed.value)
        }

        return typeof transformed === 'undefined' ? prop : transformed
      }))

      return cmp
    }, { type: 'div', props, children: [] })

    cmp.html = ['div', 'input', 'img'].includes(cmp.type)

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