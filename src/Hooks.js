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

  const aliases = {
    'Ext.bind': 'Ext.Function.bind'
  }

  const withAlias = variable => (aliases[variable] || variable)

  // Possibly breaking changes are noted with each transform

  const variableTransforms = parseTransforms({
    '*.app.*'               : { fn: (appName, methodName) => ([`App.${methodName}`]), lib: 'App' },
    'Ext.Array.clean'       : { fn: () => ['_.compact'], lib: '_' },
    'Ext.Array.difference'  : { fn: () => ['_.difference'], lib: '_' },
    'Ext.Array.flatten'     : { fn: () => ['_.flattenDeep'], lib: '_' },
    'Ext.Array.intersect'   : { fn: () => ['_.intersection'], lib: '_' },
    'Ext.Array.pluck'       : { fn: () => ['_.map'], lib: '_' },
    'Ext.Array.remove'      : { fn: () => ['_.pull'], lib: '_' },
    'Ext.Array.unique'      : { fn: () => ['_.uniq'], lib: '_' },
    'Ext.String.capitalize' : { fn: () => ['_.upperFirst'], lib: '_' },
    'Ext.isEmpty'           : { fn: () => ['_.isEmpty'], lib: '_' },
    'Ext.isFunction'        : { fn: () => ['_.isFunction'], lib: '_' }
  })

  const callTransforms = parseTransforms({
    'Ext.Array.contains': (array, item) => `${wrapExpression(array)}.includes(${Ast.toString(item)})`,

    'Ext.Array.each': (array, fn, scope, reverse) => {
      if(!_.isUndefined(scope) || !_.isUndefined(reverse)){
        return null
      }

      return `${wrapExpression(array)}.forEach(${Ast.toString(fn)})`
    },

    'Ext.Array.indexOf': (array, item, from) => `${wrapExpression(array)}.indexOf(${getArgs(item, from)})`,

    'Ext.Function.bind': (fn, scope, args, appendArgs) => {
      if(!_.isUndefined(args) && (_.isUndefined(appendArgs) || Ast.toString(appendArgs) !== '0')){
        return null
      }

      scope = _.isUndefined(scope) ? 'window' : Ast.toString(scope)
      args  = _.isUndefined(args) ? '' : `, ${explodeArray(args)}`

      return `${wrapExpression(fn)}.bind(${scope}${args})`
    },

    'Ext.Object.each': (object, fn, scope) => {
      if(!_.isUndefined(scope)){
        return null
      }

      return `_.forEach(${Ast.toString(object)}, ${Ast.toString(swapParams(fn, 0, 1))})`
    },

    'Ext.String.leftPad': (string, size, character) => `${wrapExpression(string)}.padStart(${getArgs(size, character)})`,

    // string must be present; no default string return value; trims spaces, not list of chars in trimRegex
    'Ext.String.trim': string => `${wrapExpression(string)}.trim()`
  })

  const wrapExpression = member => {
    let code = Ast.toString(member),
        wrap = Ast.isTernary(member)

    return wrap ? `(${code})` : code
  }

  const explodeArray = array => {
    let code = Ast.toString(array)
    return Ast.isArray(array) ? code.replace(/(^\[|\]$)/g, '') : `...${wrapExpression(code)}`
  }

  const swapParams = (fn, index1, index2) => {
    let copy = Ast.copy(fn),
        p1   = copy.params[index1],
        p2   = copy.params[index2]

    copy.params[index1] = p2
    copy.params[index2] = p1

    return copy
  }

  const getArgs = (...args) => _.compact(args).map(Ast.toString).join(', ')

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
      let fnName = withAlias(Ast.toString(path.node.callee))

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
      let expression = withAlias(Ast.toString(path.node)),
          transform  = variableTransforms.find(transform => expression.match(transform.check))

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