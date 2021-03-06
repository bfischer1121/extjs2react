import { namedTypes as t, builders as b, visit } from 'ast-types'
import prettier from 'prettier'
import _ from 'lodash'
import Ast from './Ast'
import { code } from './Util'

const config = {
  prettier: { semi: false, singleQuote: true, printWidth: 120 },
  varToLet: true,
  arrowFunctions: true,
  arrowReturnShorthand: true,
  arrowExpressionShorthand: true,
  templateLiterals: true
}

export const transformTemplateLiterals = node => {
  if(!config.templateLiterals){
    return
  }

  const getTemplateSubstring = node => {
    if(Ast.isString(node)){
      return node.value
    }

    if(Ast.isTemplate(node)){
      return Ast.toString(node).replace(/^`(.*)`$/, '$1')
    }

    return '${' + Ast.toString(node) + '}'
  }

  const transform = node => {
    visit(node, {
      visitBinaryExpression: function(path){
        // this.traverse must come first to process any child BinaryExpressions first
        // otherwise, foo() + ' bar' + ' baz' -> `${`${foo()} bar`} baz` instead of `${foo()} bar baz`
        this.traverse(path)

        const { node } = path

        if(node.operator === '+' && [node.left, node.right].find(n => Ast.isString(n) || Ast.isTemplate(n))){
          path.replace(Ast.from('`' + getTemplateSubstring(node.left) + getTemplateSubstring(node.right) + '`').expression)
        }
      }
    })
  }

  transform(node)
}

export const transformArrowFunctions = node => {
  if(!config.arrowFunctions){
    return
  }

  visit(node, {
    visitFunctionExpression: function(path){
      let { node } = path,
          transform = true

      // don't transform if using "arguments" or "this"
      visit(node, {
        visitIdentifier: function(path){
          if(path.node.name === 'arguments'){
            transform = false
          }

          this.traverse(path)
        },

        visitThisExpression: function(path){
          transform = false
          this.traverse(path)
        }
      })

      if(transform){
        let arrowFn = b.arrowFunctionExpression(node.params, node.body)
        arrowFn.async = node.async
        path.replace(arrowFn)
      }

      this.traverse(path)
    }
  })
}

export const transformArrowShorthand = node => {
  if(!config.arrowReturnShorthand && !config.arrowExpressionShorthand){
    return
  }

  visit(node, {
    visitArrowFunctionExpression: function(path){
      const block = path.node.body

      if(block.type === 'BlockStatement' && block.body.length === 1){
        let isReturn = (block.body[0].type === 'ReturnStatement' && block.body[0].argument)

        if(isReturn || config.arrowExpressionShorthand){
          let bodyNode = isReturn ? block.body[0].argument : (Ast.isExpressionStatement(block.body[0]) ? block.body[0] : null)

          if(bodyNode && (bodyNode.comments || []).length === 0){
            let bodyCode  = Ast.toString(bodyNode).replace(/;$/, ''),
                multiLine = bodyCode.includes('\n')

            if(isReturn || !multiLine){
              if(!isReturn){
                bodyNode = bodyNode.expression
              }

              path.node.body = multiLine ? Ast.from(code('(', [bodyCode], ')')) : bodyNode
            }
          }
        }
      }

      this.traverse(path)
    }
  })
}

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
    'Ext.bind'   : 'Ext.Function.bind',
    'Ext.encode' : 'Ext.JSON.encode'
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
    'Ext.JSON.decode'       : { fn: () => ['JSON.parse'] },
    'Ext.JSON.encode'       : { fn: () => ['JSON.stringify'] },
    'Ext.Number.constrain'  : { fn: () => ['_.clamp'], lib: '_' },
    'Ext.String.capitalize' : { fn: () => ['_.upperFirst'], lib: '_' },
    'Ext.baseCSSPrefix'     : { fn: () => ['\'x-\''] },
    'Ext.clone'             : { fn: () => ['_.cloneDeep'], lib: '_' },
    'Ext.emptyFn'           : { fn: () => ['() => {}'], lib: '_' },
    'Ext.isArray'           : { fn: () => ['_.isArray'], lib: '_' },
    'Ext.isDate'            : { fn: () => ['_.isDate'], lib: '_' },
    'Ext.isDefined'         : { fn: () => ['!_.isUndefined'], lib: '_' },
    'Ext.isEmpty'           : { fn: () => ['_.isEmpty'], lib: '_' },
    'Ext.isFunction'        : { fn: () => ['_.isFunction'], lib: '_' },
    'Ext.isNumber'          : { fn: () => ['_.isFinite'], lib: '_' },
    'Ext.isString'          : { fn: () => ['_.isString'], lib: '_' }
  })

  const _callTransforms = {
    'Ext.Array.contains': (array, item) => `${wrapExpression(array)}.includes(${Ast.toString(item)})`,

    'Ext.Array.each': (array, fn, scope, reverse) => {
      if(!_.isUndefined(scope) || !_.isUndefined(reverse)){
        return null
      }

      return `${wrapExpression(array)}.forEach(${Ast.toString(fn)})`
    },

    'Ext.Array.indexOf': (array, item, from) => `${wrapExpression(array)}.indexOf(${getArgs(item, from)})`,

    'Ext.Array.map': (array, fn, scope) => `${wrapExpression(array)}.map(${getArgs(fn, scope)})`,

    'Ext.Function.bind': (fn, scope, args, appendArgs) => {
      if(!_.isUndefined(args) && (_.isUndefined(appendArgs) || Ast.toString(appendArgs) !== '0')){
        return null
      }

      scope = _.isUndefined(scope) ? 'window' : Ast.toString(scope)
      args  = _.isUndefined(args) ? '' : `, ${explodeArray(args)}`

      return `${wrapExpression(fn)}.bind(${scope}${args})`
    },

    'Ext.Number.toFixed': (value, precision) => `${wrapExpression(value)}.toFixed(${Ast.toString(precision)})`,

    'Ext.Object.each': (object, fn, scope) => {
      if(!_.isUndefined(scope)){
        return null
      }

      return `_.forEach(${Ast.toString(object)}, ${Ast.toString(swapParams(fn, 0, 1))})`
    },

    'Ext.Object.getSize': object => `Object.keys(${Ast.toString(object)}).length`,

    'Ext.String.leftPad': (string, size, character) => `${wrapExpression(string)}.padStart(${getArgs(size, character)})`,

    // string must be present; no default string return value; trims spaces, not list of chars in trimRegex
    'Ext.String.trim': string => `${wrapExpression(string)}.trim()`,

    'Ext.defer': (fn, millis, scope, args, appendArgs) => {
      fn = (!_.isUndefined(scope) || !_.isUndefined(args))
        ? _callTransforms['Ext.Function.bind'](fn, scope, args, appendArgs)
        : Ast.toString(fn)

      if(!fn){
        return null
      }

      return `setTimeout(${fn}, ${Ast.toString(millis)})`
    },

    'Ext.apply': (object, config, defaults) => {
      // esprima can't parse object spread: https://github.com/jquery/esprima/issues/1588
      // let toSpread = (...objects) => '{ ' + _.compact(objects).map(obj => `...(${wrapExpression(obj)})`).join(', ') + ' }'
      // return Ast.isObject(object) ? toSpread(object, defaults, config) : `Object.assign(${Ast.toString(object)}, ${toSpread(defaults, config)})`
      defaults = _.isUndefined(defaults) ? '' : `, ${Ast.toString(defaults) || {}}`
      return `Object.assign(${Ast.toString(object)}${defaults}, ${Ast.toString(config)})`
    },

    'Ext.applyIf': (object, config) => (
      `_.assignWith(${Ast.toString(object)}, ${Ast.toString(config)}, (objValue, srcValue) => _.isUndefined(objValue) ? srcValue : objValue)`
    ),

    'Ext.isNumeric': value => `_.isFinite(+${Ast.toString(value)})`
  }

  const callTransforms = parseTransforms(_callTransforms)

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

  if(config.varToLet){
    visit(ast, {
      visitVariableDeclaration: function(path){
        if(
          path.node.kind === 'var' &&
          Ast.isBlock(path.parent.node) &&
          Ast.isFunction(path.parent.parent.node)
        ){
          path.replace(Ast.from(Ast.toString(path.node).replace(/^var/, 'let')))
        }

        this.traverse(path)
      }
    })
  }

  if(config.arrowFunctions){
    const needsMeReferences = node => {
      let needsMe = false

      visit(node, {
        visitFunctionExpression: function(path){
          visit(path.node, {
            visitIdentifier: function(path){
              if(path.node.name === 'me'){
                needsMe = true
              }

              this.traverse(path)
            }
          })

          this.traverse(path)
        }
      })

      return needsMe
    }

    const removeMeTraversal = function(path){
      if(!needsMeReferences(path.node)){
        Ast.removeVariable(path.node, 'me', 'this')
      }

      this.traverse(path)
    }

    transformArrowFunctions(ast)

    visit(ast, {
      visitClassMethod             : removeMeTraversal,
      visitArrowFunctionExpression : removeMeTraversal,
      visitFunctionExpression      : removeMeTraversal
    })

    transformArrowFunctions(ast)
  }

  transformArrowShorthand(ast)

  transformTemplateLiterals(ast)

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
  if(config.prettier){
    try{
      code = prettier.format(code, { parser: 'babel', ...config.prettier })
    }
    catch(e){
      code = removeSemicolons(code)
    }
  }

  if(!config.prettier){
    code = removeSemicolons(code)
  }

  return code
}