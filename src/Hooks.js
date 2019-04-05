import { namedTypes as t, visit } from 'ast-types'
import _ from 'lodash'
import { Ast } from './Util'

export const beforeTranspile = codebase => {
  
}

export const afterTranspile = ast => {
  const deleteCalls = ['this.initConfig']

  let libraries = []

  let transforms = {
    '*.app.*' : { fn: (node, appName, methodName) => ([`App.${methodName}`]), lib: 'App' },
    'Ext.isEmpty'    : { fn: () => ['_.isEmpty'], lib: '_' },
    'Ext.isFunction' : { fn: () => ['_.isFunction'], lib: '_' }
  }

  transforms = Object.keys(transforms).map(key => ({
    check     : new RegExp('^' + key.replace(/\./g, '\\.').replace(/\*/g, '([A-Z0-9_]+)') + '$', 'i'),
    transform : transforms[key].fn || transforms[key],
    library   : transforms[key].lib || null
  }))

  let getContext = path => {
    let methodPath = Ast.up(path, Ast.isMethod),
        classPath  = Ast.up(path, Ast.isClass)

    return {
      method        : methodPath ? methodPath.node.key.name : null,
      extendedClass : classPath ? ((classPath.node.superClass || {}).name || null) : null
    }
  }

  visit(ast, {
    visitMemberExpression: function(path){
      let expression = Ast.toString(path.node),
          transform  = transforms.find(({ check }) => expression.match(check))

      if(transform){
        let [newExpression] = transform.transform(path.node, ...expression.match(transform.check).slice(1))
        path.replace(Ast.from(newExpression))

        if(transform.library && !libraries.includes(transform.library)){
          libraries.push(transform.library)
        }
      }

      this.traverse(path)
    },

    visitCallExpression: function(path){
      let fnName = Ast.toString(path.node.callee)

      if(deleteCalls.includes(fnName)){
        path.prune()
      }

      if(fnName === 'this.callParent'){
        let context = getContext(path)

        if(context.method === 'constructor'){
          if(!context.extendedClass){
            path.prune()
          }
        }
      }

      this.traverse(path)
    }
  })

  return libraries
}

const removeSemicolons = code => code.replace(/;$/gm, '')

export const beforeSave = code => {
  code = removeSemicolons(code)

  return code
}