import { namedTypes as t, visit } from 'ast-types'
import _ from 'lodash'
import { Ast } from './Util'

export const beforeTranspile = codebase => {
  
}

export const afterTranspile = ast => {
  const deleteCalls = ['this.initConfig']

  const libraries = []

  const parseTransforms = transforms => (
    Object.keys(transforms).map(key => ({
      check     : new RegExp('^' + key.replace(/\./g, '\\.').replace(/\*/g, '([A-Z0-9_]+)') + '$', 'i'),
      transform : transforms[key].fn || transforms[key],
      library   : transforms[key].lib || null
    }))
  )

  const variableTransforms = parseTransforms({
    '*.app.*'               : { fn: (appName, methodName) => ([`App.${methodName}`]), lib: 'App' },
    'Ext.String.capitalize' : { fn: () => ['_.upperFirst'], lib: '_' },
    'Ext.isEmpty'           : { fn: () => ['_.isEmpty'], lib: '_' },
    'Ext.isFunction'        : { fn: () => ['_.isFunction'], lib: '_' }
  })

  const callTransforms = parseTransforms({
    'Ext.Array.each' : (array, fn, scope, reverse) => {
      if(!_.isUndefined(scope) || !_.isUndefined(reverse)){
        return null
      }

      return `${wrapExpression(array)}.forEach(${Ast.toString(fn)})`
    }
  })

  const wrapExpression = member => {
    let code = Ast.toString(member),
        wrap = Ast.isTernary(member)

    return wrap ? `(${code})` : code
  }

  const getContext = path => {
    let methodPath = Ast.up(path, Ast.isMethod),
        classPath  = Ast.up(path, Ast.isClass)

    return {
      method        : methodPath ? methodPath.node.key.name : null,
      extendedClass : classPath ? ((classPath.node.superClass || {}).name || null) : null
    }
  }

  visit(ast, {
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

      let transform = callTransforms.find(transform => fnName.match(transform.check))

      if(transform){
        let newNode = transform.transform(...path.node.arguments)

        if(newNode){
          path.replace(Ast.from(newNode))

          if(transform.library && !libraries.includes(transform.library)){
            libraries.push(transform.library)
          }
        }
      }

      this.traverse(path)
    }
  })

  visit(ast, {
    visitMemberExpression: function(path){
      let expression = Ast.toString(path.node),
          transform  = variableTransforms.find(({ check }) => expression.match(check))

      if(transform){
        let [newExpression] = transform.transform(...expression.match(transform.check).slice(1))
        path.replace(Ast.from(newExpression))

        if(transform.library && !libraries.includes(transform.library)){
          libraries.push(transform.library)
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