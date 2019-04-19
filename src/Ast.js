import _ from 'lodash'
import recast from 'recast'
import { namedTypes as t, builders as b, visit, eachField } from 'ast-types'

class AST{
  parseWithJSX(source){
    return recast.parse(source, { parser: require('recast/parsers/babel') }).program.body[0]
  }

  from(source){
    return recast.parse(source).program.body[0]
  }

  toString(ast){
    return recast.print(ast).code
  }

  copy(node){
    let copy = {}
    eachField(node, (name, value) => copy[name] = value)
    return copy
  }

  up(path, test){
    for(let parent = path.parent; parent; parent = parent.parent){
      if(test(parent.node)){
        return parent
      }
    }

    return null
  }

  getMethodCall(node){
    return this.toString(node.callee)
  }

  isIdentifier(node){
    return t.Identifier.check(node)
  }

  isString(node){
    return t.Literal.check(node) && _.isString(node.value)
  }

  isBoolean(node){
    return t.Literal.check(node) && _.isBoolean(node.value)
  }

  isNull(node){
    return t.Literal.check(node) && _.isNull(node.value)
  }

  isObject(node){
    return t.ObjectExpression.check(node)
  }

  isArray(node){
    return t.ArrayExpression.check(node)
  }

  isMemberExpression(node){
    return t.MemberExpression.check(node)
  }

  isTernary(node){
    return t.ConditionalExpression.check(node)
  }

  isFunction(node){
    return (t.FunctionExpression.check(node) || t.ArrowFunctionExpression.check(node))
  }

  isBlock(node){
    return t.BlockStatement.check(node)
  }

  isClass(node){
    return t.ClassDeclaration.check(node)
  }

  isMethod(node){
    return t.ClassMethod.check(node) || t.MethodDefinition.check(node)
  }

  getConfig(config, name){
    return this.toValue(this.getProperty(config, name))
  }

  getPropertyNode(object, name){
    return this.getProperties(object, [name])[0]
  }

  getProperty(object, name){
    return (this.getPropertyNode(object, name) || {}).value
  }

  getPropertiesExcept(object, ...exclude){
    return this.getProperties(object, null, exclude)
  }

  getProperties(object, include, exclude){
    return object.properties.filter(node => {
      let name = this.getPropertyName(node)
      return (include ? include.includes(name) : true) && (exclude ? !exclude.includes(name) : true)
    })
  }

  getPropertyName(node){
    return node.key.name || node.key.value
  }

  toValue(node){
    if(!node){
      return undefined
    }

    if(this.isArray(node)){
      return node.elements
    }

    if(this.isObject(node)){
      return node.properties
    }

    return node.value
  }

  removeVariable(node, name, ifSetTo){
    let declarationRe   = new RegExp(`${name}\\s*\\=\\s*${ifSetTo}\\,?\\s*`, 'g'),
        trailingCommaRe = /\,\s*$/g,
        replaceWith     = ifSetTo,
        isDeclared      = false

    visit(node, {
      visitVariableDeclaration: function(path){
        if(path.node.declarations.find(d => d.id.name === name)){
          (path.node.declarations.length === 1)
            ? path.prune()
            : path.replace(Ast.from(Ast.toString(path.node).replace(declarationRe, '').replace(trailingCommaRe, '')))
          isDeclared = true
        }

        this.traverse(path)
      }
    })

    if(isDeclared){
      visit(node, {
        visitIdentifier: function(path){
          if(path.node.name === name){
            path.replace(replaceWith === 'this' ? b.thisExpression() : b.identifier(replaceWith))
          }

          this.traverse(path)
        }
      })
    }
  }
}

const Ast = new AST()

export default Ast